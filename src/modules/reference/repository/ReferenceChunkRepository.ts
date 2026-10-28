import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/shared/persistence';
import { ReferenceChunkDraft } from '@/modules/reference/chunker';

/** Fragmento candidato para el contexto del agente, con los datos de su documento. */
export interface ReferenceChunkHit {
  id: string;
  documentId: string;
  documentTitle: string;
  category: string;
  language: string;
  pageFrom: number | null;
  pageTo: number | null;
  content: string;
  /** 1 = idéntico, 0 = nada que ver (similitud coseno). Null si se buscó sin vector o no está vectorizado. */
  similarity: number | null;
  /** true si el fragmento menciona alguno de los identificadores buscados (CAS, número ONU). */
  lexical: boolean;
}

/** Fragmento de un documento del producto (FDS de una materia prima, de un análogo…). */
export interface ProductChunkHit {
  id: string;
  documentId: string;
  position: number;
  pageFrom: number | null;
  pageTo: number | null;
  content: string;
  /** Secciones de la FDS en las que está el fragmento (detectadas al fragmentar; vacío = no se supo). */
  sdsSections: number[];
  /** El fragmento está en una de las secciones de FDS pedidas. */
  tagged: boolean;
  similarity: number | null;
}

export interface ProductChunkSearch {
  documentIds: string[];
  sections: number[];
  embedding?: number[];
  /** Máximo de candidatos POR DOCUMENTO en cada búsqueda (por sección y semántica). */
  limitPerDocument: number;
}

export interface ReferenceChunkSearch {
  sections: number[];
  /** Vector de la consulta. Sin vector (IA apagada) solo cuenta la coincidencia de identificadores. */
  embedding?: number[];
  /** Textos exactos a buscar (CAS, "UN1170", "UN 1170"…), sin distinguir mayúsculas. */
  identifiers: string[];
  /** Máximo de candidatos por búsqueda (semántica y de identificadores). */
  limit: number;
}

const INSERT_BATCH = 200;
/** pgvector espera el literal '[0.1,0.2,…]'. */
const toVector = (values: number[]): string => `[${values.join(',')}]`;
/** Escapa % y _ para usar el texto tal cual dentro de un ILIKE. */
const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/**
 * Fragmentos de los documentos de referencia + vectores (pgvector). Las columnas `vector` no las maneja el
 * cliente de Prisma: se usa SQL directo con parámetros (sin interpolar valores en el texto).
 */
@Injectable()
export class ReferenceChunkRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Reemplaza todos los fragmentos del documento (al reindexar se parte de cero). */
  async replace(documentId: string, chunks: readonly ReferenceChunkDraft[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM reference_chunks WHERE document_id = ${documentId}::uuid`;
      for (let start = 0; start < chunks.length; start += INSERT_BATCH) {
        const rows = chunks
          .slice(start, start + INSERT_BATCH)
          .map(
            (chunk) =>
              Prisma.sql`(gen_random_uuid(), ${documentId}::uuid, ${chunk.position}, ${chunk.pageFrom}, ${chunk.pageTo}, ${chunk.content}, ${chunk.sdsSections}::int[])`,
          );
        await tx.$executeRaw`
          INSERT INTO reference_chunks (id, document_id, position, page_from, page_to, content, sds_sections)
          VALUES ${Prisma.join(rows)}`;
      }
    });
  }

  findPendingEmbedding(documentId: string, limit: number): Promise<Array<{ id: string; content: string }>> {
    return this.prisma.$queryRaw<Array<{ id: string; content: string }>>`
      SELECT id, content FROM reference_chunks
      WHERE document_id = ${documentId}::uuid AND embedding IS NULL
      ORDER BY position LIMIT ${limit}`;
  }

  /** Guarda los vectores de un lote de fragmentos en una sola sentencia. */
  async setEmbeddings(rows: ReadonlyArray<{ id: string; embedding: number[] }>, model: string): Promise<void> {
    if (!rows.length) return;
    const values = rows.map((row) => Prisma.sql`(${row.id}::uuid, ${toVector(row.embedding)}::vector)`);
    await this.prisma.$executeRaw`
      UPDATE reference_chunks AS c SET embedding = v.embedding, embedding_model = ${model}
      FROM (VALUES ${Prisma.join(values)}) AS v(id, embedding)
      WHERE c.id = v.id`;
  }

  async countEmbedded(documentId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ embedded: number }>>`
      SELECT count(embedding)::int AS embedded FROM reference_chunks WHERE document_id = ${documentId}::uuid`;
    return row?.embedded ?? 0;
  }

  /**
   * Candidatos para el contexto del agente, SOLO de documentos indexados (READY) que aporten a esas
   * secciones (o a todas): los más parecidos a la consulta y los que mencionan los identificadores del
   * producto. El ranking final lo decide el servicio.
   */
  async findCandidates(search: ReferenceChunkSearch): Promise<ReferenceChunkHit[]> {
    const select = Prisma.sql`
      c.id, c.document_id AS "documentId", d.title AS "documentTitle", d.category::text AS category,
      d.language, c.page_from AS "pageFrom", c.page_to AS "pageTo", c.content`;
    const documents = Prisma.sql`
      d.status = 'READY' AND d.scope = 'LIBRARY'
      AND (cardinality(d.sds_sections) = 0 OR d.sds_sections && ${search.sections}::int[])`;
    const patterns = search.identifiers.map(likePattern);
    const lexicalMatch = patterns.length ? Prisma.sql`c.content ILIKE ANY(${patterns}::text[])` : Prisma.sql`false`;

    const similarity = search.embedding
      ? Prisma.sql`CASE WHEN c.embedding IS NULL THEN NULL ELSE 1 - (c.embedding <=> ${toVector(search.embedding)}::vector) END`
      : Prisma.sql`NULL::float`;

    const [semantic, lexical] = await Promise.all([
      search.embedding
        ? this.prisma.$queryRaw<ReferenceChunkHit[]>`
            SELECT ${select}, ${similarity} AS similarity, ${lexicalMatch} AS lexical
            FROM reference_chunks c JOIN reference_documents d ON d.id = c.document_id
            WHERE ${documents} AND c.embedding IS NOT NULL
            ORDER BY c.embedding <=> ${toVector(search.embedding)}::vector
            LIMIT ${search.limit}`
        : Promise.resolve([]),
      patterns.length
        ? this.prisma.$queryRaw<ReferenceChunkHit[]>`
            SELECT ${select}, ${similarity} AS similarity, true AS lexical
            FROM reference_chunks c JOIN reference_documents d ON d.id = c.document_id
            WHERE ${documents} AND ${lexicalMatch}
            LIMIT ${search.limit}`
        : Promise.resolve([]),
    ]);

    const byId = new Map<string, ReferenceChunkHit>();
    for (const hit of [...semantic, ...lexical]) {
      const known = byId.get(hit.id);
      byId.set(hit.id, known ? { ...known, lexical: known.lexical || hit.lexical } : hit);
    }
    return [...byId.values()];
  }

  /**
   * Candidatos de los documentos del producto adjuntos a una generación: los fragmentos que están en las
   * secciones pedidas (una FDS del proveedor trae su propia sección 5) y los más parecidos a la consulta
   * (datos del producto final, FDS sin secciones reconocibles). El tope es POR DOCUMENTO: uno largo no deja
   * sin candidatos a los demás. El ranking lo decide el servicio.
   */
  async findProductCandidates(search: ProductChunkSearch): Promise<ProductChunkHit[]> {
    if (!search.documentIds.length) return [];
    const vector = search.embedding ? toVector(search.embedding) : null;
    const select = Prisma.sql`
      c.id, c.document_id AS "documentId", c.position, c.page_from AS "pageFrom", c.page_to AS "pageTo", c.content,
      c.sds_sections AS "sdsSections", (c.sds_sections && ${search.sections}::int[]) AS tagged,
      ${vector ? Prisma.sql`CASE WHEN c.embedding IS NULL THEN NULL ELSE 1 - (c.embedding <=> ${vector}::vector) END` : Prisma.sql`NULL::float`} AS similarity`;
    const documents = Prisma.sql`c.document_id = ANY(${search.documentIds}::uuid[])`;
    // Los primeros N de cada documento según el orden dado (ROW_NUMBER por documento).
    const topPerDocument = (where: Prisma.Sql, order: Prisma.Sql) => this.prisma.$queryRaw<ProductChunkHit[]>`
      SELECT "id", "documentId", "position", "pageFrom", "pageTo", "content", "sdsSections", "tagged", "similarity"
      FROM (
        SELECT ${select}, ROW_NUMBER() OVER (PARTITION BY c.document_id ORDER BY ${order}) AS rank
        FROM reference_chunks c WHERE ${documents} AND ${where}
      ) ranked
      WHERE rank <= ${search.limitPerDocument}`;

    const [bySection, semantic] = await Promise.all([
      topPerDocument(Prisma.sql`c.sds_sections && ${search.sections}::int[]`, Prisma.sql`c.position`),
      vector
        ? topPerDocument(Prisma.sql`c.embedding IS NOT NULL`, Prisma.sql`c.embedding <=> ${vector}::vector`)
        : Promise.resolve([]),
    ]);

    const byId = new Map<string, ProductChunkHit>();
    for (const hit of [...bySection, ...semantic]) if (!byId.has(hit.id)) byId.set(hit.id, hit);
    return [...byId.values()];
  }
}

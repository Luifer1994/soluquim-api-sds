import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/shared/persistence';
import { KnowledgeChunkDraft } from '@/modules/knowledge/chunker';

export interface StoredChunkRef {
  id: string;
  chunkKey: string;
  contentHash: string;
  embedded: boolean;
}

export interface KnowledgeSearchHit {
  id: string;
  cas: string | null;
  source: string;
  title: string;
  content: string;
  sdsSections: number[];
  sourceUrl: string | null;
  language: string;
  /** 1 = idéntico, 0 = nada que ver (similitud coseno). Null si se buscó sin vector. */
  similarity: number | null;
}

export interface KnowledgeSearchParams {
  casList: string[];
  sections: number[];
  /** Vector de la consulta. Sin vector (IA apagada) se devuelve por metadatos, sin ranking semántico. */
  embedding?: number[];
  /** Máximo de fragmentos POR CAS (así un componente no tapa a los demás). */
  perCas: number;
}

/** Fragmento candidato para el contexto del agente, con su relación con las secciones pedidas. */
export interface KnowledgeContextCandidate extends KnowledgeSearchHit {
  chunkKey: string;
  /** true si el fragmento está etiquetado para alguna de las secciones pedidas. */
  tagged: boolean;
}

/** pgvector espera el literal '[0.1,0.2,…]'. */
const toVector = (values: number[]): string => `[${values.join(',')}]`;

/**
 * Fragmentos de conocimiento + vectores (pgvector). Las columnas `vector` no las maneja el cliente de
 * Prisma: se usa SQL directo con parámetros (sin interpolar valores en el texto).
 */
@Injectable()
export class KnowledgeChunkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findRefs(cas: string, source: string): Promise<StoredChunkRef[]> {
    return this.prisma.$queryRaw<StoredChunkRef[]>`
      SELECT id, chunk_key AS "chunkKey", content_hash AS "contentHash", (embedding IS NOT NULL) AS embedded
      FROM knowledge_chunks WHERE cas = ${cas} AND source = ${source}`;
  }

  /** Inserta o actualiza. Si el contenido cambió, el vector viejo se descarta (queda pendiente). */
  async upsert(cas: string, source: string, sourceVersion: number, chunk: KnowledgeChunkDraft): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO knowledge_chunks
        (id, cas, source, chunk_key, source_version, sds_sections, title, content, language, source_url, content_hash, updated_at)
      VALUES
        (gen_random_uuid(), ${cas}, ${source}, ${chunk.chunkKey}, ${sourceVersion}, ${chunk.sdsSections}::int[],
         ${chunk.title}, ${chunk.content}, ${chunk.language}, ${chunk.sourceUrl ?? null}, ${chunk.contentHash}, now())
      ON CONFLICT (cas, source, chunk_key) DO UPDATE SET
        source_version  = EXCLUDED.source_version,
        sds_sections    = EXCLUDED.sds_sections,
        title           = EXCLUDED.title,
        content         = EXCLUDED.content,
        language        = EXCLUDED.language,
        source_url      = EXCLUDED.source_url,
        embedding       = CASE WHEN knowledge_chunks.content_hash = EXCLUDED.content_hash THEN knowledge_chunks.embedding END,
        embedding_model = CASE WHEN knowledge_chunks.content_hash = EXCLUDED.content_hash THEN knowledge_chunks.embedding_model END,
        content_hash    = EXCLUDED.content_hash,
        updated_at      = now()`;
  }

  /** Borra los fragmentos de (cas, fuente) que ya no existen en la versión actual de la fuente. */
  async deleteExcept(cas: string, source: string, keepKeys: string[]): Promise<number> {
    if (!keepKeys.length) {
      return this.prisma.$executeRaw`DELETE FROM knowledge_chunks WHERE cas = ${cas} AND source = ${source}`;
    }
    return this.prisma.$executeRaw`
      DELETE FROM knowledge_chunks WHERE cas = ${cas} AND source = ${source} AND chunk_key <> ALL(${keepKeys}::text[])`;
  }

  async findPendingEmbedding(cas: string, limit: number): Promise<Array<{ id: string; content: string }>> {
    return this.prisma.$queryRaw<Array<{ id: string; content: string }>>`
      SELECT id, content FROM knowledge_chunks WHERE cas = ${cas} AND embedding IS NULL ORDER BY updated_at LIMIT ${limit}`;
  }

  async setEmbedding(id: string, embedding: number[], model: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE knowledge_chunks SET embedding = ${toVector(embedding)}::vector, embedding_model = ${model} WHERE id = ${id}::uuid`;
  }

  async countByCas(casList: string[]): Promise<Array<{ cas: string; total: number; embedded: number }>> {
    return this.prisma.$queryRaw<Array<{ cas: string; total: number; embedded: number }>>`
      SELECT cas, count(*)::int AS total, count(embedding)::int AS embedded
      FROM knowledge_chunks WHERE cas = ANY(${casList}::text[]) GROUP BY cas`;
  }

  /** Los `perCas` fragmentos más relevantes de cada CAS para esas secciones. */
  async search(params: KnowledgeSearchParams): Promise<KnowledgeSearchHit[]> {
    const { casList, sections, perCas } = params;
    if (!casList.length) return [];
    const select = Prisma.sql`id, cas, source, title, content, sds_sections AS "sdsSections", source_url AS "sourceUrl", language`;

    if (!params.embedding) {
      return this.prisma.$queryRaw<KnowledgeSearchHit[]>`
        SELECT ${select}, NULL::float AS similarity FROM (
          SELECT *, row_number() OVER (PARTITION BY cas ORDER BY source, chunk_key) AS rank
          FROM knowledge_chunks
          WHERE cas = ANY(${casList}::text[]) AND sds_sections && ${sections}::int[]
        ) ranked WHERE rank <= ${perCas}`;
    }

    const vector = toVector(params.embedding);
    return this.prisma.$queryRaw<KnowledgeSearchHit[]>`
      SELECT ${select}, similarity FROM (
        SELECT *, 1 - (embedding <=> ${vector}::vector) AS similarity,
               row_number() OVER (PARTITION BY cas ORDER BY embedding <=> ${vector}::vector) AS rank
        FROM knowledge_chunks
        WHERE cas = ANY(${casList}::text[]) AND sds_sections && ${sections}::int[] AND embedding IS NOT NULL
      ) ranked WHERE rank <= ${perCas}
      ORDER BY similarity DESC`;
  }

  /**
   * TODOS los fragmentos vigentes de esos CAS, cada uno con si está etiquetado para las secciones pedidas
   * y su similitud con la consulta. El armado del contexto (qué entra y en qué orden) lo decide el servicio.
   */
  async findContextCandidates(
    casList: string[],
    sections: number[],
    embedding?: number[],
  ): Promise<KnowledgeContextCandidate[]> {
    if (!casList.length) return [];
    const similarity = embedding
      ? Prisma.sql`CASE WHEN embedding IS NULL THEN NULL ELSE 1 - (embedding <=> ${toVector(embedding)}::vector) END`
      : Prisma.sql`NULL::float`;
    return this.prisma.$queryRaw<KnowledgeContextCandidate[]>`
      SELECT id, cas, source, chunk_key AS "chunkKey", title, content, sds_sections AS "sdsSections",
             source_url AS "sourceUrl", language,
             (sds_sections && ${sections}::int[]) AS tagged,
             ${similarity} AS similarity
      FROM knowledge_chunks
      WHERE cas = ANY(${casList}::text[])`;
  }
}

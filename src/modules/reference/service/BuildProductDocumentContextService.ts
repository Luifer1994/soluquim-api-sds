import { Inject, Injectable } from '@nestjs/common';
import { ReferenceDocumentCategory } from '@prisma/client';
import { AiStatus, EMBEDDING_PROVIDER, EmbeddingProvider } from '@/shared/ai';
import { BaseService } from '@/shared/base';
import { AppConfig } from '@/shared/config';
import { Result } from '@/shared/util';
import { SdsSectionCatalog } from '@/modules/knowledge';
import { ReferenceDocumentMapper } from '@/modules/reference/mapper';
import { ProductChunkHit, ReferenceChunkRepository } from '@/modules/reference/repository';
import { ProductDocument } from '@/modules/reference/service/PrepareProductDocumentsService';

export interface BuildProductDocumentContextInput {
  documents: ProductDocument[];
  sections: number[];
  /** Cómo se describe el producto en la consulta semántica. */
  product: string;
  maxChars?: number;
}

export interface ProductDocumentFragment extends ProductChunkHit {
  document: ProductDocument;
  /** "FDS Etanol (Merck) · p. 3–4": así se cita en la FDS. */
  citationTitle: string;
}

/** Candidatos por documento y por búsqueda (por sección y semántica) antes del reparto. */
const CANDIDATES_PER_DOCUMENT = 30;
/**
 * Lo único que se toma de una FDS análoga (otra composición o concentración): el modelo de las MEDIDAS
 * (primeros auxilios, incendio, derrame, manipulación, protección, eliminación). Sus peligros, propiedades,
 * toxicología o transporte no son los de este producto, así que esos fragmentos ni llegan al agente.
 */
const ANALOGOUS_SECTIONS = new Set([4, 5, 6, 7, 8, 13]);
/** Primero los datos del producto final, luego los de los componentes; los análogos al final. */
const CATEGORY_ORDER: Partial<Record<ReferenceDocumentCategory, number>> = {
  [ReferenceDocumentCategory.PRODUCT_DATA]: 0,
  [ReferenceDocumentCategory.SUPPLIER_SDS]: 1,
  [ReferenceDocumentCategory.ANALOGOUS_SDS]: 2,
};

/**
 * Contexto de los DOCUMENTOS DEL PRODUCTO para un grupo de secciones: de cada documento adjunto, primero
 * los fragmentos que están en esas secciones (la sección 5 de la FDS del proveedor para redactar la 5) y
 * luego los más parecidos. Reparte el presupuesto por turnos entre documentos, para que todos los
 * componentes queden representados y ninguno tape a los demás.
 */
@Injectable()
export class BuildProductDocumentContextService extends BaseService<
  BuildProductDocumentContextInput,
  ProductDocumentFragment[]
> {
  constructor(
    private readonly chunks: ReferenceChunkRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly ai: AiStatus,
    private readonly config: AppConfig,
  ) {
    super();
  }

  async execute(input: BuildProductDocumentContextInput): Promise<Result<ProductDocumentFragment[]>> {
    const budget = input.maxChars ?? this.config.ai.productDocumentsContextMaxChars;
    if (!input.documents.length || budget <= 0) return Result.success([]);
    try {
      const query = [...input.sections.map((n) => SdsSectionCatalog.describe(n)), `Producto: ${input.product}`].join(
        '\n',
      );
      const embedding = this.ai.enabled ? (await this.embeddings.embed([query]))[0] : undefined;
      const candidates = await this.chunks.findProductCandidates({
        documentIds: input.documents.map((d) => d.id),
        sections: input.sections,
        embedding,
        limitPerDocument: CANDIDATES_PER_DOCUMENT,
      });
      return Result.success(
        BuildProductDocumentContextService.select(candidates, input.documents, input.sections, budget),
      );
    } catch (error) {
      return this.handleException('BuildProductDocumentContext', error);
    }
  }

  /** Ranking y reparto por turnos entre documentos hasta el presupuesto (función pura). */
  static select(
    candidates: readonly ProductChunkHit[],
    documents: readonly ProductDocument[],
    sections: readonly number[],
    budget: number,
  ): ProductDocumentFragment[] {
    // De un análogo, solo los fragmentos de las secciones de medidas que se están redactando.
    const analogousSections = sections.filter((n) => ANALOGOUS_SECTIONS.has(n));
    const usable = (hit: ProductChunkHit, document: ProductDocument) =>
      document.category !== ReferenceDocumentCategory.ANALOGOUS_SDS ||
      hit.sdsSections.some((n) => analogousSections.includes(n));

    const ordered = [...documents].sort(
      (a, b) => (CATEGORY_ORDER[a.category] ?? 4) - (CATEGORY_ORDER[b.category] ?? 4),
    );
    const queues = ordered.map((document) =>
      candidates
        .filter((hit) => hit.documentId === document.id && usable(hit, document))
        .sort(
          (a, b) =>
            Number(b.tagged) - Number(a.tagged) || (b.similarity ?? 0) - (a.similarity ?? 0) || a.position - b.position,
        )
        .map((hit) => ({ hit, document })),
    );

    const selected: ProductDocumentFragment[] = [];
    let used = 0;
    for (let round = 0; queues.some((queue) => queue.length > round); round++) {
      for (const queue of queues) {
        const entry = queue[round];
        if (!entry || used + entry.hit.content.length > budget) continue;
        selected.push({
          ...entry.hit,
          document: entry.document,
          citationTitle: ReferenceDocumentMapper.citationTitle(
            entry.document.title,
            entry.hit.pageFrom,
            entry.hit.pageTo,
          ),
        });
        used += entry.hit.content.length;
      }
    }
    // En el prompt, cada documento junto y en orden de lectura.
    return selected.sort(
      (a, b) => ordered.indexOf(a.document) - ordered.indexOf(b.document) || a.position - b.position,
    );
  }
}

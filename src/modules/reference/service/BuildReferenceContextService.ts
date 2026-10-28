import { Inject, Injectable } from '@nestjs/common';
import { AiStatus, EMBEDDING_PROVIDER, EmbeddingProvider } from '@/shared/ai';
import { BaseService } from '@/shared/base';
import { AppConfig } from '@/shared/config';
import { Result } from '@/shared/util';
import { SdsSectionCatalog } from '@/modules/knowledge';
import { ReferenceDocumentMapper } from '@/modules/reference/mapper';
import { ReferenceChunkHit, ReferenceChunkRepository } from '@/modules/reference/repository';

export interface BuildReferenceContextInput {
  /** Secciones de la FDS que se van a redactar. */
  sections: number[];
  /** Cómo se describe el producto en la consulta: nombres, CAS, tipo (sustancia / mezcla). */
  product: string;
  /**
   * Identificadores exactos del producto y sus componentes: CAS y números ONU ("UN1170"). Un fragmento que
   * los menciona (la fila de la GRE, el listado de mercancías peligrosas) entra con prioridad.
   */
  identifiers: string[];
  /** Términos que afinan la consulta: códigos H, clases de peligro, clase de transporte. */
  terms?: string[];
  /** Presupuesto de caracteres (por defecto AI_REFERENCE_CONTEXT_MAX_CHARS). */
  maxChars?: number;
}

export interface ReferenceContextFragment extends ReferenceChunkHit {
  /** "GRE 2024 · p. 155–156": así se cita en la FDS. */
  citationTitle: string;
}

/** Candidatos por búsqueda (semántica y de identificadores) antes de recortar al presupuesto. */
const CANDIDATES = 40;
/** Lo que suma a la similitud un fragmento que menciona un identificador del producto. */
const IDENTIFIER_BONUS = 0.15;
/** Ningún documento ocupa más que esta parte del presupuesto (que un libro grande no tape a los demás). */
const MAX_SHARE_PER_DOCUMENT = 0.6;

/**
 * Contexto de DOCUMENTACIÓN DE REFERENCIA para un grupo de secciones: los fragmentos de los documentos
 * cargados (SGA, GRE, Reglamentación Modelo, Manual de Pruebas, procedimientos de M&S) más útiles para
 * redactar esas secciones de ESTE producto. Búsqueda híbrida:
 *   - semántica: lo que deben contener las secciones + el producto + sus peligros,
 *   - exacta: fragmentos que mencionan sus CAS o números ONU (bonificación en el ranking).
 * Se recorta a un presupuesto de caracteres y ningún documento acapara el presupuesto. Sin documentos
 * cargados devuelve una lista vacía y la generación sigue igual que antes.
 */
@Injectable()
export class BuildReferenceContextService extends BaseService<BuildReferenceContextInput, ReferenceContextFragment[]> {
  constructor(
    private readonly chunks: ReferenceChunkRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly ai: AiStatus,
    private readonly config: AppConfig,
  ) {
    super();
  }

  async execute(input: BuildReferenceContextInput): Promise<Result<ReferenceContextFragment[]>> {
    const budget = input.maxChars ?? this.config.ai.referenceContextMaxChars;
    if (budget <= 0) return Result.success([]);
    try {
      const embedding = this.ai.enabled
        ? (await this.embeddings.embed([BuildReferenceContextService.query(input)]))[0]
        : undefined;
      const candidates = await this.chunks.findCandidates({
        sections: input.sections,
        embedding,
        identifiers: input.identifiers,
        limit: CANDIDATES,
      });
      return Result.success(BuildReferenceContextService.select(candidates, budget));
    } catch (error) {
      return this.handleException('BuildReferenceContext', error);
    }
  }

  /** Texto de la consulta semántica: qué deben contener las secciones, de qué producto y con qué peligros. */
  static query(input: BuildReferenceContextInput): string {
    return [
      ...input.sections.map((number) => SdsSectionCatalog.describe(number)),
      `Producto: ${input.product}`,
      input.identifiers.length ? `Identificadores: ${input.identifiers.join(', ')}` : '',
      input.terms?.length ? `Peligros y clasificación: ${input.terms.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Ranking y recorte (función pura): similitud + bonificación por identificador, hasta el presupuesto. */
  static select(candidates: readonly ReferenceChunkHit[], budget: number): ReferenceContextFragment[] {
    const score = (hit: ReferenceChunkHit) => (hit.similarity ?? 0) + (hit.lexical ? IDENTIFIER_BONUS : 0);
    const ranked = [...candidates].sort(
      (a, b) =>
        score(b) - score(a) || a.documentTitle.localeCompare(b.documentTitle) || (a.pageFrom ?? 0) - (b.pageFrom ?? 0),
    );
    const documents = new Set(ranked.map((hit) => hit.documentId)).size;
    const perDocument = documents > 1 ? budget * MAX_SHARE_PER_DOCUMENT : budget;

    const selected: ReferenceContextFragment[] = [];
    const usedByDocument = new Map<string, number>();
    let used = 0;
    for (const hit of ranked) {
      const size = hit.content.length;
      const documentUsed = usedByDocument.get(hit.documentId) ?? 0;
      // Uno grande que no cabe no bloquea a los siguientes.
      if (used + size > budget || documentUsed + size > perDocument) continue;
      selected.push({
        ...hit,
        citationTitle: ReferenceDocumentMapper.citationTitle(hit.documentTitle, hit.pageFrom, hit.pageTo),
      });
      used += size;
      usedByDocument.set(hit.documentId, documentUsed + size);
    }
    return selected;
  }
}

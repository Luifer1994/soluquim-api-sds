import { Inject, Injectable } from '@nestjs/common';
import { AiStatus, EMBEDDING_PROVIDER, EmbeddingProvider } from '@/shared/ai';
import { BaseService } from '@/shared/base';
import { Result } from '@/shared/util';
import { SdsSectionCatalog } from '@/modules/knowledge/catalog';
import { KnowledgeChunkRepository, KnowledgeSearchHit } from '@/modules/knowledge/repository';

export interface SearchKnowledgeInput {
  casList: string[];
  /** Secciones de la FDS a cubrir. */
  sections: number[];
  /** Texto de la consulta. Por defecto, el contenido esperado de esas secciones (catálogo). */
  query?: string;
  /** Máximo de fragmentos por CAS. */
  perCas?: number;
}

/**
 * Búsqueda semántica en la base de conocimiento: los fragmentos más relevantes de cada componente
 * para las secciones pedidas. Sin IA, cae a búsqueda por metadatos (mismas secciones, sin ranking).
 */
@Injectable()
export class SearchKnowledgeService extends BaseService<SearchKnowledgeInput, KnowledgeSearchHit[]> {
  /** El vector de la consulta por defecto de cada grupo de secciones se calcula una sola vez. */
  private readonly queryVectors = new Map<string, Promise<number[]>>();

  constructor(
    private readonly chunks: KnowledgeChunkRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly ai: AiStatus,
  ) {
    super();
  }

  async execute({
    casList,
    sections,
    query,
    perCas = 12,
  }: SearchKnowledgeInput): Promise<Result<KnowledgeSearchHit[]>> {
    try {
      const text = query ?? sections.map((n) => SdsSectionCatalog.describe(n)).join('\n');
      const embedding = this.ai.enabled ? await this.vectorFor(text, !query) : undefined;
      return Result.success(await this.chunks.search({ casList, sections, embedding, perCas }));
    } catch (error) {
      return this.handleException('SearchKnowledge', error);
    }
  }

  private vectorFor(text: string, cacheable: boolean): Promise<number[]> {
    const compute = async () => (await this.embeddings.embed([text]))[0];
    if (!cacheable) return compute();
    let cached = this.queryVectors.get(text);
    if (!cached) {
      cached = compute().catch((error: unknown) => {
        this.queryVectors.delete(text);
        throw error;
      });
      this.queryVectors.set(text, cached);
    }
    return cached;
  }
}

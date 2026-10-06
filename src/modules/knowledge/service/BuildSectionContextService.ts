import { Inject, Injectable } from '@nestjs/common';
import { AiStatus, EMBEDDING_PROVIDER, EmbeddingProvider } from '@/shared/ai';
import { BaseService } from '@/shared/base';
import { AppConfig } from '@/shared/config';
import { Result } from '@/shared/util';
import { SdsSectionCatalog } from '@/modules/knowledge/catalog';
import { KnowledgeChunkRepository, KnowledgeContextCandidate } from '@/modules/knowledge/repository';

export type ContextRelevance = 'core' | 'section' | 'related';

export interface SectionContextFragment extends KnowledgeContextCandidate {
  /**
   * core    = identidad y clasificación del componente (siempre va, en todas las secciones),
   * section = fragmento etiquetado para las secciones que se redactan,
   * related = resto del conocimiento de la sustancia, por similitud semántica.
   */
  relevance: ContextRelevance;
}

export interface BuildSectionContextInput {
  casList: string[];
  sections: number[];
  /** Presupuesto de caracteres (por defecto AI_CONTEXT_MAX_CHARS). */
  maxChars?: number;
}

/** Fragmentos "núcleo": lo mínimo que el agente debe saber de cada componente al redactar CUALQUIER sección. */
const CORE: Array<{ source: string; chunkKey: string }> = [
  { source: 'PUBCHEM', chunkKey: 'identity' },
  { source: 'ECHA', chunkKey: 'ghs.harmonised' },
];
const PRIORITY: Record<ContextRelevance, number> = { core: 0, section: 1, related: 2 };

/**
 * Arma el contexto que recibe el agente para un grupo de secciones, con TODO el conocimiento vigente de
 * todas las fuentes de cada componente, priorizado y acotado por un presupuesto de tamaño:
 *   1. núcleo (identidad + clasificación armonizada) de cada componente,
 *   2. todos los fragmentos etiquetados para esas secciones, de todas las fuentes,
 *   3. el resto del RAG, por similitud semántica con lo que la sección debe contener.
 * El presupuesto se reparte en partes iguales entre los componentes (ninguno tapa a los demás). Con una
 * sustancia sola entra prácticamente todo; con mezclas grandes entra lo más relevante de cada componente.
 */
@Injectable()
export class BuildSectionContextService extends BaseService<BuildSectionContextInput, SectionContextFragment[]> {
  private readonly queryVectors = new Map<string, Promise<number[]>>();

  constructor(
    private readonly chunks: KnowledgeChunkRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly ai: AiStatus,
    private readonly config: AppConfig,
  ) {
    super();
  }

  async execute({ casList, sections, maxChars }: BuildSectionContextInput): Promise<Result<SectionContextFragment[]>> {
    try {
      const embedding = this.ai.enabled ? await this.queryVector(sections) : undefined;
      const candidates = await this.chunks.findContextCandidates(casList, sections, embedding);
      const budgetPerCas = Math.floor((maxChars ?? this.config.ai.contextMaxChars) / Math.max(casList.length, 1));
      return Result.success(
        casList.flatMap((cas) =>
          BuildSectionContextService.select(
            candidates.filter((c) => c.cas === cas),
            budgetPerCas,
          ),
        ),
      );
    } catch (error) {
      return this.handleException('BuildSectionContext', error);
    }
  }

  /** Selección para UN componente (función pura): por prioridad y similitud, hasta agotar el presupuesto. */
  static select(candidates: KnowledgeContextCandidate[], budget: number): SectionContextFragment[] {
    const ranked = candidates
      .map((candidate): SectionContextFragment => ({
        ...candidate,
        relevance: CORE.some((core) => core.source === candidate.source && core.chunkKey === candidate.chunkKey)
          ? 'core'
          : candidate.tagged
            ? 'section'
            : 'related',
      }))
      .sort(
        (a, b) =>
          PRIORITY[a.relevance] - PRIORITY[b.relevance] ||
          (b.similarity ?? 0) - (a.similarity ?? 0) ||
          a.source.localeCompare(b.source) ||
          a.chunkKey.localeCompare(b.chunkKey),
      );

    const selected: SectionContextFragment[] = [];
    let used = 0;
    for (const fragment of ranked) {
      const size = fragment.title.length + fragment.content.length;
      // El núcleo entra siempre; lo demás, mientras quepa (uno grande que no cabe no bloquea a los siguientes).
      if (fragment.relevance !== 'core' && used + size > budget) continue;
      selected.push(fragment);
      used += size;
    }
    return selected;
  }

  /** El vector de "lo que deben contener estas secciones" se calcula una vez por grupo. */
  private queryVector(sections: number[]): Promise<number[]> {
    const key = sections.join(',');
    let cached = this.queryVectors.get(key);
    if (!cached) {
      const text = sections.map((n) => SdsSectionCatalog.describe(n)).join('\n');
      cached = this.embeddings
        .embed([text])
        .then((vectors) => vectors[0])
        .catch((error: unknown) => {
          this.queryVectors.delete(key);
          throw error;
        });
      this.queryVectors.set(key, cached);
    }
    return cached;
  }
}

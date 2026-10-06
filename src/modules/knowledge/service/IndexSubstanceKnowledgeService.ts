import { Inject, Injectable } from '@nestjs/common';
import { AiStatus, EMBEDDING_PROVIDER, EmbeddingProvider } from '@/shared/ai';
import { BaseService } from '@/shared/base';
import { Result } from '@/shared/util';
import { ListCurrentSourceDataService } from '@/modules/substance';
import { SourceKnowledgeChunker } from '@/modules/knowledge/chunker';
import { KnowledgeChunkRepository } from '@/modules/knowledge/repository';

export interface IndexSubstanceKnowledgeInput {
  cas: string;
  /** Solo estas fuentes (por defecto, todas las guardadas del CAS). */
  sources?: string[];
}

export interface IndexSubstanceKnowledgeResult {
  cas: string;
  chunks: number;
  created: number;
  updated: number;
  removed: number;
  embedded: number;
  /** Fragmentos guardados sin vector (IA apagada o error al vectorizar): se completan en otra pasada. */
  pendingEmbedding: number;
}

const EMBED_BATCH = 64;

/**
 * (Re)construye la base de conocimiento de un CAS a partir de los datos VIGENTES de sus fuentes:
 *  1. fragmenta cada fuente (SourceKnowledgeChunker),
 *  2. guarda solo lo nuevo o cambiado (content_hash) y borra lo que la fuente ya no trae,
 *  3. vectoriza SOLO los fragmentos sin vector (no se paga dos veces por el mismo texto).
 * Idempotente: correrlo dos veces seguidas no cambia nada ni llama al proveedor de embeddings.
 */
@Injectable()
export class IndexSubstanceKnowledgeService extends BaseService<
  IndexSubstanceKnowledgeInput,
  IndexSubstanceKnowledgeResult
> {
  constructor(
    private readonly currentSourceData: ListCurrentSourceDataService,
    private readonly chunks: KnowledgeChunkRepository,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly ai: AiStatus,
  ) {
    super();
  }

  async execute({ cas, sources }: IndexSubstanceKnowledgeInput): Promise<Result<IndexSubstanceKnowledgeResult>> {
    try {
      const current = await this.currentSourceData.execute({ cas, sources });
      if (!current.isSuccess || !current.data) return Result.failure('SOURCE_DATA_UNAVAILABLE', current.message, 500);

      const stats = { chunks: 0, created: 0, updated: 0, removed: 0, embedded: 0, pendingEmbedding: 0 };
      for (const source of current.data.sources) {
        const drafts =
          source.status === 'OK'
            ? SourceKnowledgeChunker.chunk({
                cas,
                substanceName: current.data.substanceName,
                source: source.source,
                records: source.records,
              })
            : [];
        const stored = new Map((await this.chunks.findRefs(cas, source.source)).map((ref) => [ref.chunkKey, ref]));

        for (const draft of drafts) {
          const existing = stored.get(draft.chunkKey);
          if (existing?.contentHash === draft.contentHash) continue;
          await this.chunks.upsert(cas, source.source, source.version, draft);
          if (existing) stats.updated++;
          else stats.created++;
        }
        stats.removed += await this.chunks.deleteExcept(
          cas,
          source.source,
          drafts.map((d) => d.chunkKey),
        );
        stats.chunks += drafts.length;
      }

      const embedding = await this.embedPending(cas);
      return Result.success({ cas, ...stats, ...embedding });
    } catch (error) {
      return this.handleException('IndexSubstanceKnowledge', error);
    }
  }

  private async embedPending(cas: string): Promise<{ embedded: number; pendingEmbedding: number }> {
    let embedded = 0;
    if (this.ai.enabled) {
      for (;;) {
        const pending = await this.chunks.findPendingEmbedding(cas, EMBED_BATCH);
        if (!pending.length) break;
        const vectors = await this.embeddings.embed(pending.map((chunk) => chunk.content));
        for (const [index, chunk] of pending.entries()) {
          await this.chunks.setEmbedding(chunk.id, vectors[index], this.embeddings.model);
        }
        embedded += pending.length;
        if (pending.length < EMBED_BATCH) break;
      }
    }
    const [counts] = await this.chunks.countByCas([cas]);
    return { embedded, pendingEmbedding: counts ? counts.total - counts.embedded : 0 };
  }
}

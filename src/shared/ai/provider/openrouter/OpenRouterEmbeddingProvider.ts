import { IPolicy } from 'cockatiel';
import { EmbeddingProvider } from '@/shared/ai/contract';
import { OpenRouterHttpClient } from '@/shared/ai/provider/openrouter/OpenRouterHttpClient';
import { ExternalHttpError } from '@/shared/http';
import { buildResiliencePolicy } from '@/shared/resilience';

interface EmbeddingsResponse {
  data?: Array<{ index: number; embedding: number[] }>;
}

/** Textos por petición. */
const BATCH_SIZE = 64;

/** Embeddings vía OpenRouter (`/embeddings`). */
export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openrouter';
  private readonly policy: IPolicy;

  constructor(
    private readonly http: OpenRouterHttpClient,
    readonly model: string,
    readonly dimensions: number,
  ) {
    this.policy = buildResiliencePolicy({
      timeoutMs: 60_000,
      maxAttempts: 3,
      maxConcurrent: 4,
      maxQueued: 200,
      isNonRetryable: (error) => error instanceof ExternalHttpError && !error.isRetryable,
    }).policy;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const response = await this.policy.execute(({ signal }) =>
        this.http.post<EmbeddingsResponse>(
          '/embeddings',
          { model: this.model, input: batch, dimensions: this.dimensions },
          signal,
        ),
      );
      const ordered = [...(response.data ?? [])].sort((a, b) => a.index - b.index).map((item) => item.embedding);
      if (ordered.length !== batch.length) throw new Error(`Embeddings incompletos: ${ordered.length}/${batch.length}`);
      const wrong = ordered.find((vector) => vector.length !== this.dimensions);
      if (wrong) {
        throw new Error(
          `${this.model} devolvió ${wrong.length} dimensiones; la BD espera ${this.dimensions} (AI_EMBEDDING_DIMENSIONS)`,
        );
      }
      vectors.push(...ordered);
    }
    return vectors;
  }
}

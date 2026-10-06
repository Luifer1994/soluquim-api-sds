import { IPolicy } from 'cockatiel';
import { LlmProvider, LlmRequest, LlmResponse } from '@/shared/ai/contract';
import { OpenRouterHttpClient } from '@/shared/ai/provider/openrouter/OpenRouterHttpClient';
import { ExternalHttpError } from '@/shared/http';
import { buildResiliencePolicy } from '@/shared/resilience';

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/** LLM vía OpenRouter (`/chat/completions`), con salida estructurada por JSON Schema. */
export class OpenRouterLlmProvider implements LlmProvider {
  readonly name = 'openrouter';
  private readonly policy: IPolicy;

  constructor(
    private readonly http: OpenRouterHttpClient,
    maxConcurrency: number,
  ) {
    this.policy = buildResiliencePolicy({
      timeoutMs: 180_000,
      maxAttempts: 3,
      maxConcurrent: maxConcurrency,
      maxQueued: 100,
      isNonRetryable: (error) => error instanceof ExternalHttpError && !error.isRetryable,
    }).policy;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.policy.execute(({ signal }) =>
      this.http.post<ChatCompletionResponse>(
        '/chat/completions',
        {
          model: request.model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          ...(request.jsonSchema && {
            response_format: {
              type: 'json_schema',
              json_schema: { name: request.schemaName ?? 'response', strict: false, schema: request.jsonSchema },
            },
          }),
          usage: { include: true },
        },
        signal,
      ),
    );

    const choice = response.choices?.[0];
    const content = choice?.message?.content ?? '';
    if (choice?.finish_reason === 'length') throw new Error('El LLM cortó la respuesta por límite de tokens');
    if (!content) throw new Error(`Respuesta vacía del LLM (${choice?.finish_reason ?? 'sin finish_reason'})`);
    return {
      content,
      model: response.model ?? request.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        cost: response.usage?.cost,
      },
    };
  }
}

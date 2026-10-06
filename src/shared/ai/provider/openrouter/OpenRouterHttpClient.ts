import { AiUnavailableError } from '@/shared/ai/AiUnavailableError';
import { ExternalHttpError, parseRetryAfter } from '@/shared/http';

export interface OpenRouterSettings {
  apiKey?: string;
  baseUrl: string;
}

/**
 * HTTP de OpenRouter (API compatible con OpenAI). Lo comparten el proveedor de LLM y el de embeddings.
 * Todas las peticiones salen con `provider.data_collection = "deny"`: OpenRouter solo enruta a
 * proveedores que NO guardan ni entrenan con los datos (las fórmulas son secreto industrial).
 */
export class OpenRouterHttpClient {
  constructor(private readonly settings: OpenRouterSettings) {}

  get configured(): boolean {
    return Boolean(this.settings.apiKey);
  }

  async post<T>(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    if (!this.settings.apiKey) throw new AiUnavailableError('OpenRouter (OPENROUTER_API_KEY)');
    const url = `${this.settings.baseUrl}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${this.settings.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://soluquim.co',
        'X-Title': 'Soluquim SDS',
      },
      body: JSON.stringify({ ...body, provider: { data_collection: 'deny', require_parameters: true } }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ExternalHttpError(
        response.status,
        url,
        text.slice(0, 300),
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }
    const parsed = JSON.parse(text) as T & { error?: { message?: string; code?: number } };
    if (parsed.error) throw new ExternalHttpError(parsed.error.code ?? 502, url, parsed.error.message);
    return parsed;
  }
}

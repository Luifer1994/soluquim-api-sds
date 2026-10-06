import { EmbeddingProvider, LlmProvider } from '@/shared/ai/contract';
import { OpenRouterEmbeddingProvider, OpenRouterHttpClient, OpenRouterLlmProvider } from '@/shared/ai/provider';
import { AppConfig } from '@/shared/config';

interface ProviderBuilder {
  llm(config: AppConfig): LlmProvider;
  embedding(config: AppConfig): EmbeddingProvider;
  /** Si tiene credenciales (sin ellas la IA queda apagada, pero el servicio arranca). */
  configured(config: AppConfig): boolean;
}

/**
 * Proveedores de IA disponibles (patrón Factory). Agregar un proveedor = implementar LlmProvider y
 * EmbeddingProvider en `shared/ai/provider/<nombre>/` y sumar una entrada aquí. Cuál se usa lo decide
 * AI_PROVIDER en el .env; ningún agente cambia.
 */
const PROVIDERS: Record<string, ProviderBuilder> = {
  openrouter: {
    llm: (config) => new OpenRouterLlmProvider(openRouterHttp(config), config.ai.llm.maxConcurrency),
    embedding: (config) =>
      new OpenRouterEmbeddingProvider(
        openRouterHttp(config),
        config.ai.embedding.model,
        config.ai.embedding.dimensions,
      ),
    configured: (config) => Boolean(config.ai.apiKey),
  },
};

function openRouterHttp(config: AppConfig): OpenRouterHttpClient {
  return new OpenRouterHttpClient({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl });
}

export class AiProviderFactory {
  static available(): string[] {
    return Object.keys(PROVIDERS);
  }

  static isConfigured(config: AppConfig): boolean {
    return AiProviderFactory.builder(config).configured(config);
  }

  static createLlm(config: AppConfig): LlmProvider {
    return AiProviderFactory.builder(config).llm(config);
  }

  static createEmbedding(config: AppConfig): EmbeddingProvider {
    return AiProviderFactory.builder(config).embedding(config);
  }

  private static builder(config: AppConfig): ProviderBuilder {
    const builder = PROVIDERS[config.ai.provider];
    if (!builder) {
      throw new Error(
        `AI_PROVIDER "${config.ai.provider}" no existe. Disponibles: ${AiProviderFactory.available().join(', ')}`,
      );
    }
    return builder;
  }
}

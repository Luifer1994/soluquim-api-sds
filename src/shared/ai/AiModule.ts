import { Global, Module } from '@nestjs/common';
import { AgentSettings } from '@/shared/ai/agent/AgentSettings';
import { AiStatus } from '@/shared/ai/AiStatus';
import { EMBEDDING_PROVIDER, LLM_PROVIDER } from '@/shared/ai/contract';
import { AiProviderFactory } from '@/shared/ai/factory/AiProviderFactory';
import { AppConfig } from '@/shared/config';

/**
 * IA genérica: el proveedor concreto lo elige el factory según AI_PROVIDER. Quien usa IA inyecta los
 * contratos (`@Inject(LLM_PROVIDER)`, `@Inject(EMBEDDING_PROVIDER)`), nunca una clase de proveedor.
 */
@Global()
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      useFactory: (config: AppConfig) => AiProviderFactory.createLlm(config),
      inject: [AppConfig],
    },
    {
      provide: EMBEDDING_PROVIDER,
      useFactory: (config: AppConfig) => AiProviderFactory.createEmbedding(config),
      inject: [AppConfig],
    },
    AgentSettings,
    AiStatus,
  ],
  exports: [LLM_PROVIDER, EMBEDDING_PROVIDER, AgentSettings, AiStatus],
})
export class AiModule {}

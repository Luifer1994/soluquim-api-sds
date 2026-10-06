import { Injectable } from '@nestjs/common';
import { AppConfig } from '@/shared/config';

/**
 * Parámetros de cada agente desde la configuración. Cambiar el modelo de UN agente es solo .env:
 * `AI_AGENT_MODELS=sds-section-drafting=deepseek/deepseek-v4-pro`; los demás siguen con AI_LLM_MODEL.
 */
@Injectable()
export class AgentSettings {
  constructor(private readonly config: AppConfig) {}

  modelFor(agentName: string): string {
    return this.config.ai.agentModels.get(agentName) ?? this.config.ai.llm.model;
  }

  get temperature(): number {
    return this.config.ai.llm.temperature;
  }

  get maxOutputTokens(): number {
    return this.config.ai.llm.maxOutputTokens;
  }
}

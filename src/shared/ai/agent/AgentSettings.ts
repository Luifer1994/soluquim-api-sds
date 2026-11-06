import { Injectable } from '@nestjs/common';
import { AppConfig } from '@/shared/config';
import { AgentLimits } from '@/shared/ai/agent/AgentRunContext';

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

  /** Modelo propio del agente en AI_AGENT_MODELS, si tiene (para heredar el de otro agente cuando no). */
  modelOverride(agentName: string): string | undefined {
    return this.config.ai.agentModels.get(agentName);
  }

  get temperature(): number {
    return this.config.ai.llm.temperature;
  }

  get maxOutputTokens(): number {
    return this.config.ai.llm.maxOutputTokens;
  }

  /** Vueltas máximas modelo → herramientas de un agente con herramientas. */
  get maxSteps(): number {
    return this.config.ai.agents.maxSteps;
  }

  /** Niveles máximos de subagentes (el orquestador es el nivel 0). */
  get maxDepth(): number {
    return this.config.ai.agents.maxDepth;
  }

  /** Tiempo máximo de una herramienta (incluye un subagente completo). */
  get toolTimeoutMs(): number {
    return this.config.ai.agents.toolTimeoutMs;
  }

  /** Límites de una ejecución nueva de agentes. */
  get limits(): AgentLimits {
    return { maxSteps: this.maxSteps, maxDepth: this.maxDepth, toolTimeoutMs: this.toolTimeoutMs };
  }
}

import { LlmRequest, LlmResponse } from '@/shared/ai/contract/AiTypes';

/**
 * Contrato de un proveedor de LLM. Los agentes dependen SOLO de esto, nunca de un proveedor concreto:
 * cambiar de OpenRouter a otro = otra implementación, sin tocar agentes.
 */
export interface LlmProvider {
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Token de inyección: `@Inject(LLM_PROVIDER) llm: LlmProvider`. */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

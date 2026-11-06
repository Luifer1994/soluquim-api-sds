import { LlmUsage } from '@/shared/ai/contract';
import { AgentRunContext } from '@/shared/ai/agent/AgentRunContext';

/** Un paso de la ejecución: una llamada al modelo o una herramienta (un subagente también es una herramienta). */
export interface AgentTraceEntry {
  kind: 'llm' | 'tool';
  /** Agente (llamada al modelo) o herramienta. */
  name: string;
  /** Nivel en el árbol de agentes: 0 el que se ejecutó primero, 1 sus subagentes… */
  depth: number;
  durationMs: number;
  ok: boolean;
  /** Error resumido, si falló. */
  error?: string;
}

export interface AgentRunResult<T> {
  output: T;
  /** Qué agente y versión de prompt produjo la salida (queda guardado en el documento). */
  agent: string;
  promptVersion: string;
  model: string;
  /** Uso del agente; en uno con herramientas, también el de sus subagentes. */
  usage: LlmUsage;
  /** Pasos de toda la ejecución (solo en el agente raíz; útil para auditar y depurar). */
  trace?: readonly AgentTraceEntry[];
}

/**
 * Lo que cumple todo agente, simple ({@link BaseAgent}) o con herramientas ({@link ToolCallingAgent}): por eso
 * cualquiera puede ser subagente de otro ({@link SubAgentTool}). `context` llega cuando corre dentro de otro.
 */
export interface RunnableAgent<TInput, TOutput> {
  readonly name: string;
  readonly promptVersion: string;
  run(input: TInput, context?: AgentRunContext): Promise<AgentRunResult<TOutput>>;
}

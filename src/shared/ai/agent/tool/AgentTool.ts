import { ZodType } from 'zod';
import { AgentRunContext } from '@/shared/ai/agent/AgentRunContext';

/**
 * Una herramienta que un agente puede pedir (patrón Command): nombre (lo que ve el modelo), para qué sirve y cuándo
 * usarla, el schema Zod de sus argumentos (se valida ANTES de ejecutar) y la acción. Puede vivir en cualquier
 * módulo (por ejemplo, la búsqueda del RAG en knowledge) y exportarse como cualquier provider de Nest.
 */
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  /** Solo letras, números, "_" o "-" (máx. 64): así lo exigen los proveedores. */
  readonly name: string;
  /** Lo que lee el modelo para decidir si la usa: qué hace, cuándo conviene y qué devuelve. */
  readonly description: string;
  readonly inputSchema: ZodType<TInput>;
  execute(input: TInput, context: AgentRunContext): Promise<TOutput>;
}

/** Herramienta sin clase propia, para casos simples: `defineTool({ name, description, inputSchema, execute })`. */
export function defineTool<TInput, TOutput>(tool: AgentTool<TInput, TOutput>): AgentTool<TInput, TOutput> {
  return tool;
}

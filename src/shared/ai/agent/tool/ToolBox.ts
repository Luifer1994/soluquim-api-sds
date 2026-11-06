import { ToolCall, ToolDefinition } from '@/shared/ai/contract';
import { AgentRunContext } from '@/shared/ai/agent/AgentRunContext';
import { AgentTool } from '@/shared/ai/agent/tool/AgentTool';
import { toToolParameters } from '@/shared/ai/agent/tool/ToolSchema';

/** Resultado de una herramienta, listo para devolvérselo al modelo. */
export interface ToolResult {
  callId: string;
  name: string;
  ok: boolean;
  /** Lo que lee el modelo: la salida en JSON o el error. */
  content: string;
}

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Herramientas de un agente (patrón Registry): publica sus definiciones (JSON Schema desde Zod) y ejecuta lo que
 * pide el modelo. Un error (herramienta desconocida, argumentos inválidos, fallo o timeout) NO rompe la
 * ejecución: vuelve como resultado para que el modelo corrija o siga por otro camino. También un subagente que no
 * pudo responder (límite de pasos o de profundidad): el orquestador sigue con lo demás. Solo la cancelación corta.
 */
export class ToolBox {
  private readonly byName = new Map<string, AgentTool>();
  readonly definitions: readonly ToolDefinition[];

  constructor(tools: readonly AgentTool[]) {
    for (const tool of tools) {
      if (!TOOL_NAME.test(tool.name)) throw new Error(`Nombre de herramienta inválido: "${tool.name}"`);
      if (this.byName.has(tool.name)) throw new Error(`Herramienta repetida: "${tool.name}"`);
      this.byName.set(tool.name, tool);
    }
    this.definitions = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: toToolParameters(tool.inputSchema),
    }));
  }

  /** Ejecuta las llamadas de un turno en paralelo (el proveedor ya limita la concurrencia al LLM). */
  executeAll(calls: readonly ToolCall[], context: AgentRunContext): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.execute(call, context)));
  }

  async execute(call: ToolCall, context: AgentRunContext): Promise<ToolResult> {
    const started = Date.now();
    const tool = this.byName.get(call.name);
    const outcome = tool
      ? await this.run(tool, call, context)
      : {
          ok: false,
          content: `ERROR: la herramienta "${call.name}" no existe. Disponibles: ${[...this.byName.keys()].join(', ')}`,
        };
    context.record({
      kind: 'tool',
      name: call.name,
      durationMs: Date.now() - started,
      ok: outcome.ok,
      ...(!outcome.ok && { error: outcome.content.slice(0, 300) }),
    });
    return { callId: call.id, name: call.name, ...outcome };
  }

  private async run(
    tool: AgentTool,
    call: ToolCall,
    context: AgentRunContext,
  ): Promise<{ ok: boolean; content: string }> {
    let args: unknown;
    try {
      args = JSON.parse(call.arguments || '{}');
    } catch {
      return { ok: false, content: 'ERROR: los argumentos no son un JSON válido. Vuelve a llamarla con JSON.' };
    }
    const parsed = tool.inputSchema.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`);
      return { ok: false, content: `ERROR: argumentos inválidos:\n${issues.join('\n')}` };
    }
    try {
      const output = await this.withTimeout(
        tool.execute(parsed.data, context),
        context.limits.toolTimeoutMs,
        tool.name,
      );
      return { ok: true, content: typeof output === 'string' ? output : JSON.stringify(output ?? null) };
    } catch (error) {
      context.throwIfAborted();
      return { ok: false, content: `ERROR: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`la herramienta "${name}" no respondió en ${ms} ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
}

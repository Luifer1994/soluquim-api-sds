import { ZodType } from 'zod';
import { AgentRunContext } from '@/shared/ai/agent/AgentRunContext';
import { AgentRunResult, RunnableAgent } from '@/shared/ai/agent/RunnableAgent';
import { AgentTool } from '@/shared/ai/agent/tool/AgentTool';

export interface SubAgentToolOptions<TArgs, TInput, TOutput> {
  /** Nombre con el que el orquestador lo llama (p. ej. `delegate_toxicology`). */
  name: string;
  /** Para qué delegarle: su especialidad, qué necesita recibir y qué devuelve. */
  description: string;
  /** Lo que el orquestador le pasa (corto: el subagente arma su propio contexto). */
  inputSchema: ZodType<TArgs>;
  agent: RunnableAgent<TInput, TOutput>;
  /** De los argumentos del orquestador a la entrada del subagente (p. ej. sumarle el contexto del trabajo). */
  toInput?: (args: TArgs, context: AgentRunContext) => TInput | Promise<TInput>;
  /** Lo que el orquestador recibe de vuelta (por defecto, la salida del subagente). */
  toResult?: (result: AgentRunResult<TOutput>) => unknown;
}

/**
 * Un agente como herramienta de otro (patrón Adapter): así un orquestador DELEGA. El subagente corre en un
 * contexto hijo (un nivel más abajo, con su uso sumando en el del orquestador) y solo devuelve su resultado, no su
 * conversación: el orquestador no se llena de contexto ajeno.
 */
export class SubAgentTool<TArgs, TInput, TOutput> implements AgentTool<TArgs, unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<TArgs>;

  constructor(private readonly options: SubAgentToolOptions<TArgs, TInput, TOutput>) {
    this.name = options.name;
    this.description = options.description;
    this.inputSchema = options.inputSchema;
  }

  get agent(): RunnableAgent<TInput, TOutput> {
    return this.options.agent;
  }

  async execute(args: TArgs, context: AgentRunContext): Promise<unknown> {
    const child = context.child();
    const input = this.options.toInput ? await this.options.toInput(args, child) : (args as unknown as TInput);
    const result = await this.options.agent.run(input, child);
    return this.options.toResult ? this.options.toResult(result) : result.output;
  }
}

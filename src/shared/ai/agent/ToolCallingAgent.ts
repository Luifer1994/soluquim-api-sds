import { Logger } from '@nestjs/common';
import { ZodType } from 'zod';
import { AgentLimitError } from '@/shared/ai/agent/AgentErrors';
import { AgentRunContext } from '@/shared/ai/agent/AgentRunContext';
import { AgentSettings } from '@/shared/ai/agent/AgentSettings';
import { AgentRunResult, RunnableAgent } from '@/shared/ai/agent/RunnableAgent';
import { StructuredOutput } from '@/shared/ai/agent/StructuredOutput';
import { AgentTool, toToolParameters, ToolBox, ToolResult } from '@/shared/ai/agent/tool';
import { ChatMessage, LlmProvider, ToolCall, ToolDefinition } from '@/shared/ai/contract';

/** Herramienta con la que el agente entrega su respuesta final (sus argumentos son el `outputSchema`). */
export const FINAL_ANSWER_TOOL = 'final_answer';

/**
 * Base de los agentes con herramientas (patrón Template Method). Cada agente define SOLO:
 *  - `name`, `promptVersion` y `outputSchema` (como {@link BaseAgent}),
 *  - `buildMessages(input)` (el prompt),
 *  - `tools(input)` (lo que puede usar: herramientas de cualquier módulo y subagentes, ver {@link SubAgentTool}).
 *    Recibe la entrada de la ejecución: una herramienta puede trabajar sobre los datos de ESA ejecución.
 *
 * El ciclo: el modelo pide herramientas → se ejecutan (en paralelo, con su timeout) → vuelven como mensajes → …
 * hasta que llama a `final_answer`, cuyos argumentos se validan contra `outputSchema` (si no cumplen, se le
 * devuelve el error para que corrija). Siempre se le exige llamar alguna herramienta (`toolChoice: required`):
 * así la respuesta final también es estructurada, con cualquier modelo que soporte herramientas. En el último paso
 * (`AI_AGENT_MAX_STEPS`) solo puede entregar la respuesta, con lo que tenga; si ni así la entrega, corta con
 * {@link AgentLimitError}.
 */
export abstract class ToolCallingAgent<TInput, TOutput> implements RunnableAgent<TInput, TOutput> {
  protected readonly logger = new Logger(this.constructor.name);

  abstract readonly name: string;
  abstract readonly promptVersion: string;
  protected abstract readonly outputSchema: ZodType<TOutput>;

  /** Cómo se le describe al modelo la herramienta de respuesta final (sobrescribible). */
  protected readonly finalAnswerDescription: string =
    'Entrega tu respuesta final cuando ya tengas lo necesario. Sus argumentos SON la respuesta, con el formato pedido.';

  protected constructor(
    protected readonly llm: LlmProvider,
    protected readonly settings: AgentSettings,
  ) {}

  protected abstract buildMessages(input: TInput): ChatMessage[];

  /** Herramientas del agente para esta ejecución (pueden depender de la entrada y de la configuración). */
  protected abstract tools(input: TInput): readonly AgentTool[];

  get model(): string {
    return this.settings.modelFor(this.name);
  }

  async run(input: TInput, parent?: AgentRunContext): Promise<AgentRunResult<TOutput>> {
    const context = parent ?? AgentRunContext.root(this.settings.limits);
    const toolbox = new ToolBox(this.tools(input));
    const definitions = [...toolbox.definitions, this.finalAnswerDefinition()];
    const messages = [...this.buildMessages(input)];

    const finalOnly = definitions.filter((definition) => definition.name === FINAL_ANSWER_TOOL);
    for (let step = 1; step <= context.limits.maxSteps; step++) {
      context.throwIfAborted();
      const last = step === context.limits.maxSteps;
      if (last && step > 1) {
        messages.push({
          role: 'user',
          content: `Último paso: entrega ya tu respuesta con ${FINAL_ANSWER_TOOL}, con lo que tengas.`,
        });
      }
      const started = Date.now();
      const response = await this.llm.complete({
        model: this.model,
        messages: [...messages],
        tools: last ? finalOnly : definitions,
        toolChoice: 'required',
        temperature: this.settings.temperature,
        maxOutputTokens: this.settings.maxOutputTokens,
      });
      context.addUsage(response.usage);
      context.record({ kind: 'llm', name: this.name, durationMs: Date.now() - started, ok: true });

      const calls = response.toolCalls ?? [];
      if (!calls.length) {
        // Respondió texto en vez de una herramienta: se le recuerda cómo terminar.
        messages.push(
          { role: 'assistant', content: response.content },
          { role: 'user', content: `Responde llamando a una herramienta; para terminar usa ${FINAL_ANSWER_TOOL}.` },
        );
        continue;
      }
      messages.push({ role: 'assistant', content: response.content, toolCalls: calls });

      const final = calls.find((call) => call.name === FINAL_ANSWER_TOOL);
      const answer = final && StructuredOutput.parse(final.arguments, this.outputSchema);
      if (answer?.success) {
        return {
          output: answer.data,
          agent: this.name,
          promptVersion: this.promptVersion,
          model: response.model,
          usage: context.usage,
          ...(!parent && { trace: context.trace }),
        };
      }

      const results = await toolbox.executeAll(
        calls.filter((call) => call !== final),
        context,
      );
      if (final && answer && !answer.success) {
        this.logger.warn(`${this.name}: la respuesta final no cumple el schema; se le devuelve el error`);
        results.push(this.invalidAnswer(final, answer.error));
      }
      messages.push(...results.map((result) => this.toMessage(result)));
    }
    throw new AgentLimitError(`${this.name}: no entregó la respuesta final en ${context.limits.maxSteps} pasos`);
  }

  private finalAnswerDefinition(): ToolDefinition {
    return {
      name: FINAL_ANSWER_TOOL,
      description: this.finalAnswerDescription,
      parameters: toToolParameters(this.outputSchema),
    };
  }

  private invalidAnswer(call: ToolCall, error: string): ToolResult {
    return {
      callId: call.id,
      name: call.name,
      ok: false,
      content: `ERROR: la respuesta final no cumple el formato. Corrígela y vuelve a llamar ${FINAL_ANSWER_TOOL}:\n${error}`,
    };
  }

  private toMessage(result: ToolResult): ChatMessage {
    return { role: 'tool', toolCallId: result.callId, content: result.content };
  }
}

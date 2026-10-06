import { Logger } from '@nestjs/common';
import { z, ZodType } from 'zod';
import { AgentSettings } from '@/shared/ai/agent/AgentSettings';
import { StructuredOutput } from '@/shared/ai/agent/StructuredOutput';
import { ChatMessage, LlmProvider, LlmUsage } from '@/shared/ai/contract';

export interface AgentRunResult<T> {
  output: T;
  /** Qué agente y versión de prompt produjo la salida (queda guardado en el documento). */
  agent: string;
  promptVersion: string;
  model: string;
  usage: LlmUsage;
}

/**
 * Base de todos los agentes (patrón Template Method). Cada agente define SOLO:
 *  - `name` y `promptVersion` (subir la versión cada vez que cambia el prompt: queda en cada FDS),
 *  - `outputSchema` (Zod: lo que DEBE devolver),
 *  - `buildMessages(input)` (el prompt).
 * La base resuelve el modelo (AgentSettings), pide salida estructurada, la valida y si no valida
 * reintenta UNA vez mostrándole el error al modelo. No sabe de qué proveedor se trata (LlmProvider).
 */
export abstract class BaseAgent<TInput, TOutput> {
  protected readonly logger = new Logger(this.constructor.name);
  abstract readonly name: string;
  abstract readonly promptVersion: string;
  protected abstract readonly outputSchema: ZodType<TOutput>;

  protected constructor(
    protected readonly llm: LlmProvider,
    protected readonly settings: AgentSettings,
  ) {}

  protected abstract buildMessages(input: TInput): ChatMessage[];

  get model(): string {
    return this.settings.modelFor(this.name);
  }

  async run(input: TInput): Promise<AgentRunResult<TOutput>> {
    const messages = this.buildMessages(input);
    const jsonSchema = z.toJSONSchema(this.outputSchema, { target: 'draft-7' }) as Record<string, unknown>;
    const request = {
      model: this.model,
      jsonSchema,
      schemaName: this.name.replace(/[^a-zA-Z0-9_-]/g, '_'),
      temperature: this.settings.temperature,
      maxOutputTokens: this.settings.maxOutputTokens,
    };

    const first = await this.llm.complete({ ...request, messages });
    const parsed = StructuredOutput.parse(first.content, this.outputSchema);
    if (parsed.success) return this.result(parsed.data, first.model, first.usage);

    this.logger.warn(`${this.name}: la respuesta no cumple el schema; se reintenta con el error`);
    const retry = await this.llm.complete({
      ...request,
      messages: [
        ...messages,
        { role: 'assistant', content: first.content },
        {
          role: 'user',
          content: `Tu respuesta no cumple el JSON Schema. Errores:\n${parsed.error}\nDevuelve SOLO el JSON corregido.`,
        },
      ],
    });
    const second = StructuredOutput.parse(retry.content, this.outputSchema);
    if (!second.success) throw new Error(`${this.name}: el modelo no devolvió un JSON válido: ${second.error}`);
    return this.result(second.data, retry.model, {
      promptTokens: first.usage.promptTokens + retry.usage.promptTokens,
      completionTokens: first.usage.completionTokens + retry.usage.completionTokens,
      cost: (first.usage.cost ?? 0) + (retry.usage.cost ?? 0) || undefined,
    });
  }

  private result(output: TOutput, model: string, usage: LlmUsage): AgentRunResult<TOutput> {
    return { output, agent: this.name, promptVersion: this.promptVersion, model, usage };
  }
}

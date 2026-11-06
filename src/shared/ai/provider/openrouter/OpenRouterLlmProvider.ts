import { IPolicy } from 'cockatiel';
import { ChatMessage, LlmProvider, LlmRequest, LlmResponse, ToolCall, ToolDefinition } from '@/shared/ai/contract';
import { OpenRouterHttpClient } from '@/shared/ai/provider/openrouter/OpenRouterHttpClient';
import { ExternalHttpError } from '@/shared/http';
import { buildResiliencePolicy } from '@/shared/resilience';

interface ChatCompletionToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: ChatCompletionToolCall[] };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/** Mensaje en el formato de OpenAI: las llamadas a herramientas y sus respuestas llevan sus propios campos. */
function toOpenAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.toolCalls?.length) {
    return {
      role: message.role,
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function toOpenAiTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

function toToolCalls(calls: ChatCompletionToolCall[] | undefined): ToolCall[] {
  return (calls ?? []).map((call, index) => ({
    id: call.id ?? `call_${index}`,
    name: call.function?.name ?? '',
    arguments: call.function?.arguments ?? '{}',
  }));
}

/**
 * LLM vía OpenRouter (`/chat/completions`), con salida estructurada por JSON Schema y herramientas (function
 * calling en el formato de OpenAI). Con `require_parameters` OpenRouter solo enruta a proveedores que soporten
 * lo que se pide (herramientas, JSON Schema).
 */
export class OpenRouterLlmProvider implements LlmProvider {
  readonly name = 'openrouter';
  private readonly policy: IPolicy;

  constructor(
    private readonly http: OpenRouterHttpClient,
    maxConcurrency: number,
  ) {
    this.policy = buildResiliencePolicy({
      timeoutMs: 180_000,
      maxAttempts: 3,
      maxConcurrent: maxConcurrency,
      maxQueued: 100,
      isNonRetryable: (error) => error instanceof ExternalHttpError && !error.isRetryable,
    }).policy;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.policy.execute(({ signal }) =>
      this.http.post<ChatCompletionResponse>(
        '/chat/completions',
        {
          model: request.model,
          messages: request.messages.map(toOpenAiMessage),
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
          ...(request.jsonSchema && {
            response_format: {
              type: 'json_schema',
              json_schema: { name: request.schemaName ?? 'response', strict: false, schema: request.jsonSchema },
            },
          }),
          ...(request.tools?.length && {
            tools: request.tools.map(toOpenAiTool),
            tool_choice: request.toolChoice ?? 'auto',
          }),
          usage: { include: true },
        },
        signal,
      ),
    );

    const choice = response.choices?.[0];
    const content = choice?.message?.content ?? '';
    const toolCalls = toToolCalls(choice?.message?.tool_calls);
    if (choice?.finish_reason === 'length') throw new Error('El LLM cortó la respuesta por límite de tokens');
    // Al pedir herramientas el modelo puede no escribir texto (la respuesta son las llamadas) o, a veces, no devolver
    // nada: no es un fallo del proveedor (no se reintenta ni abre el circuito); el agente le pide que termine bien.
    if (!content && !toolCalls.length && !request.tools?.length) {
      throw new Error(`Respuesta vacía del LLM (${choice?.finish_reason ?? 'sin finish_reason'})`);
    }
    return {
      content,
      ...(toolCalls.length && { toolCalls }),
      model: response.model ?? request.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        cost: response.usage?.cost,
      },
    };
  }
}

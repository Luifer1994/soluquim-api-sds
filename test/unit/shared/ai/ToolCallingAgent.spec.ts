import { z } from 'zod';
import {
  AgentLimitError,
  AgentSettings,
  AgentTool,
  ChatMessage,
  defineTool,
  FINAL_ANSWER_TOOL,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  ToolCall,
  ToolCallingAgent,
} from '@/shared/ai';
import { AppConfig, parseEnv } from '@/shared/config';

const settings = (env: Record<string, string> = {}) =>
  new AgentSettings(
    new AppConfig(parseEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d', RABBITMQ_URL: 'amqp://u:p@h:5672', ...env })),
  );

type Turn = { content?: string; calls?: Array<[string, unknown]> };

/** LLM falso: cada turno responde texto o pide herramientas (en orden). */
function scriptedLlm(...turns: Turn[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let id = 0;
  return {
    name: 'fake',
    requests,
    complete: (request: LlmRequest): Promise<LlmResponse> => {
      requests.push({ ...request, messages: [...request.messages] });
      const turn = turns.shift() ?? {};
      const toolCalls: ToolCall[] = (turn.calls ?? []).map(([name, args]) => ({
        id: `call_${++id}`,
        name,
        arguments: typeof args === 'string' ? args : JSON.stringify(args),
      }));
      return Promise.resolve({
        content: turn.content ?? '',
        model: request.model,
        usage: { promptTokens: 10, completionTokens: 5, cost: 0.001 },
        ...(toolCalls.length && { toolCalls }),
      });
    },
  };
}

const AnswerSchema = z.object({ total: z.number() });

const sumTool = defineTool({
  name: 'sum',
  description: 'Suma dos números',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  execute: ({ a, b }) => Promise.resolve({ result: a + b }),
});

class CalculatorAgent extends ToolCallingAgent<string, z.infer<typeof AnswerSchema>> {
  readonly name = 'calculator';
  readonly promptVersion = 'calculator.v1';
  protected readonly outputSchema = AnswerSchema;

  constructor(
    llm: LlmProvider,
    agentSettings: AgentSettings,
    private readonly available: readonly AgentTool[] = [sumTool],
  ) {
    super(llm, agentSettings);
  }

  protected buildMessages(input: string): ChatMessage[] {
    return [{ role: 'user', content: input }];
  }

  protected tools(): readonly AgentTool[] {
    return this.available;
  }
}

const lastMessages = (llm: { requests: LlmRequest[] }) => llm.requests[llm.requests.length - 1].messages;

describe('ToolCallingAgent', () => {
  it('ejecuta las herramientas que pide el modelo y termina con final_answer validada', async () => {
    const llm = scriptedLlm({ calls: [['sum', { a: 2, b: 3 }]] }, { calls: [[FINAL_ANSWER_TOOL, { total: 5 }]] });
    const result = await new CalculatorAgent(llm, settings()).run('2 + 3');

    expect(result.output).toEqual({ total: 5 });
    expect(llm.requests[0].toolChoice).toBe('required');
    expect(llm.requests[0].tools?.map((tool) => tool.name)).toEqual(['sum', FINAL_ANSWER_TOOL]);
    expect(lastMessages(llm)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'tool', toolCallId: 'call_1', content: '{"result":5}' }),
      ]),
    );
    // Uso de las dos llamadas y traza: llm → sum → llm.
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 10, cost: 0.002 });
    expect(result.trace?.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'llm:calculator',
      'tool:sum',
      'llm:calculator',
    ]);
  });

  it('devuelve al modelo los errores de herramienta (no existe, argumentos inválidos) sin romper', async () => {
    const llm = scriptedLlm(
      {
        calls: [
          ['missing', {}],
          ['sum', { a: 'x' }],
          ['sum', 'no-json'],
        ],
      },
      { calls: [[FINAL_ANSWER_TOOL, { total: 0 }]] },
    );
    await new CalculatorAgent(llm, settings()).run('x');

    const toolMessages = lastMessages(llm).filter((message) => message.role === 'tool');
    expect(toolMessages.map((message) => message.content)).toEqual([
      expect.stringContaining('la herramienta "missing" no existe'),
      expect.stringContaining('argumentos inválidos'),
      expect.stringContaining('no son un JSON válido'),
    ]);
  });

  it('si la respuesta final no cumple el schema, le devuelve el error y acepta la corregida', async () => {
    const llm = scriptedLlm(
      { calls: [[FINAL_ANSWER_TOOL, { total: 'cinco' }]] },
      { calls: [[FINAL_ANSWER_TOOL, { total: 5 }]] },
    );
    const result = await new CalculatorAgent(llm, settings()).run('x');

    expect(result.output.total).toBe(5);
    expect(lastMessages(llm).at(-1)).toMatchObject({
      role: 'tool',
      content: expect.stringContaining('no cumple el formato'),
    });
  });

  it('si responde texto, le recuerda terminar con final_answer', async () => {
    const llm = scriptedLlm({ content: 'Son 5' }, { calls: [[FINAL_ANSWER_TOOL, { total: 5 }]] });
    await new CalculatorAgent(llm, settings()).run('x');
    expect(lastMessages(llm).at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining(FINAL_ANSWER_TOOL),
    });
  });

  it('corta con AgentLimitError si no termina en AI_AGENT_MAX_STEPS pasos', async () => {
    const llm = scriptedLlm({ calls: [['sum', { a: 1, b: 1 }]] }, { calls: [['sum', { a: 1, b: 1 }]] });
    await expect(new CalculatorAgent(llm, settings({ AI_AGENT_MAX_STEPS: '2' })).run('x')).rejects.toThrow(
      AgentLimitError,
    );
    expect(llm.requests).toHaveLength(2);
    // En el último paso solo puede entregar la respuesta, y se le pide que lo haga con lo que tenga.
    expect(llm.requests[1].tools?.map((tool) => tool.name)).toEqual([FINAL_ANSWER_TOOL]);
    expect(lastMessages(llm).at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('Último paso') });
  });

  it('una herramienta que tarda más que AI_AGENT_TOOL_TIMEOUT_MS vuelve como error', async () => {
    const slow = defineTool({
      name: 'slow',
      description: 'Tarda',
      inputSchema: z.object({}),
      execute: () => new Promise((resolve) => setTimeout(resolve, 5_000)),
    });
    const llm = scriptedLlm({ calls: [['slow', {}]] }, { calls: [[FINAL_ANSWER_TOOL, { total: 1 }]] });
    await new CalculatorAgent(llm, settings({ AI_AGENT_TOOL_TIMEOUT_MS: '1000' }), [slow]).run('x');
    expect(lastMessages(llm).find((message) => message.role === 'tool')?.content).toContain('no respondió en 1000 ms');
  });
});

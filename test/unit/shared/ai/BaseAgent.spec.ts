import { z } from 'zod';
import { AgentSettings, BaseAgent, ChatMessage, LlmProvider, LlmRequest, LlmResponse } from '@/shared/ai';
import { AppConfig, parseEnv } from '@/shared/config';

const OutputSchema = z.object({ answer: z.string(), score: z.number() });

class EchoAgent extends BaseAgent<string, z.infer<typeof OutputSchema>> {
  readonly name = 'echo';
  readonly promptVersion = 'echo.v1';
  protected readonly outputSchema = OutputSchema;

  constructor(llm: LlmProvider, settings: AgentSettings) {
    super(llm, settings);
  }

  protected buildMessages(input: string): ChatMessage[] {
    return [{ role: 'user', content: input }];
  }
}

const settings = (env: Record<string, string> = {}) =>
  new AgentSettings(
    new AppConfig(parseEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d', RABBITMQ_URL: 'amqp://u:p@h:5672', ...env })),
  );

function fakeLlm(...contents: string[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: 'fake',
    requests,
    complete: (request: LlmRequest): Promise<LlmResponse> => {
      requests.push(request);
      return Promise.resolve({
        content: contents.shift() ?? '',
        model: request.model,
        usage: { promptTokens: 10, completionTokens: 5, cost: 0.001 },
      });
    },
  };
}

describe('BaseAgent (independiente del proveedor)', () => {
  it('pide salida estructurada con el JSON Schema y devuelve el resultado validado', async () => {
    const llm = fakeLlm('{"answer":"ok","score":1}');
    const result = await new EchoAgent(llm, settings()).run('hola');

    expect(result).toMatchObject({ output: { answer: 'ok', score: 1 }, agent: 'echo', promptVersion: 'echo.v1' });
    expect(llm.requests[0].jsonSchema).toMatchObject({ type: 'object', required: ['answer', 'score'] });
  });

  it('acepta JSON envuelto en ```json', async () => {
    const result = await new EchoAgent(fakeLlm('```json\n{"answer":"ok","score":2}\n```'), settings()).run('x');
    expect(result.output.score).toBe(2);
  });

  it('si no cumple el schema, reintenta UNA vez con el error y suma el uso', async () => {
    const llm = fakeLlm('{"answer":"ok"}', '{"answer":"ok","score":3}');
    const result = await new EchoAgent(llm, settings()).run('x');

    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1].messages.at(-1)?.content).toMatch(/score/);
    expect(result.output.score).toBe(3);
    expect(result.usage.promptTokens).toBe(20);
  });

  it('si el reintento también falla, lanza un error claro', async () => {
    await expect(new EchoAgent(fakeLlm('no es json', 'tampoco'), settings()).run('x')).rejects.toThrow(
      /no devolvió un JSON válido/,
    );
  });

  it('el modelo sale de AI_LLM_MODEL, o de AI_AGENT_MODELS para ese agente', () => {
    expect(new EchoAgent(fakeLlm(), settings({ AI_LLM_MODEL: 'a/default' })).model).toBe('a/default');
    expect(
      new EchoAgent(fakeLlm(), settings({ AI_LLM_MODEL: 'a/default', AI_AGENT_MODELS: 'otro=b/x, echo=c/barato' }))
        .model,
    ).toBe('c/barato');
  });
});

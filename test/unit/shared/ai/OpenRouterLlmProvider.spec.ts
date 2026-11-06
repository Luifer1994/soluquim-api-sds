import { OpenRouterHttpClient, OpenRouterLlmProvider } from '@/shared/ai/provider';

/** Cliente HTTP falso: guarda el cuerpo enviado y responde lo indicado. */
function fakeHttp(response: unknown): OpenRouterHttpClient & { bodies: Record<string, unknown>[] } {
  const bodies: Record<string, unknown>[] = [];
  return Object.assign(Object.create(OpenRouterHttpClient.prototype) as OpenRouterHttpClient, {
    bodies,
    post: (_path: string, body: Record<string, unknown>) => {
      bodies.push(body);
      return Promise.resolve(response);
    },
  });
}

const usage = { prompt_tokens: 3, completion_tokens: 2 };

describe('OpenRouterLlmProvider', () => {
  it('sin herramientas, la petición no cambia (sin tools ni tool_choice)', async () => {
    const http = fakeHttp({ choices: [{ message: { content: 'hola' }, finish_reason: 'stop' }], usage });
    const response = await new OpenRouterLlmProvider(http, 1).complete({
      model: 'm',
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ],
    });

    expect(response.content).toBe('hola');
    expect(response.toolCalls).toBeUndefined();
    expect(http.bodies[0].messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
    expect(http.bodies[0]).not.toHaveProperty('tools');
    expect(http.bodies[0]).not.toHaveProperty('tool_choice');
  });

  it('envía herramientas y mensajes de herramienta en formato OpenAI y lee las llamadas pedidas', async () => {
    const http = fakeHttp({
      choices: [
        {
          message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'sum', arguments: '{"a":1}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
      usage,
    });
    const response = await new OpenRouterLlmProvider(http, 1).complete({
      model: 'm',
      messages: [
        { role: 'user', content: 'u' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c0', name: 'sum', arguments: '{}' }] },
        { role: 'tool', content: '{"r":1}', toolCallId: 'c0' },
      ],
      tools: [{ name: 'sum', description: 'Suma', parameters: { type: 'object' } }],
      toolChoice: 'required',
    });

    expect(http.bodies[0].tools).toEqual([
      { type: 'function', function: { name: 'sum', description: 'Suma', parameters: { type: 'object' } } },
    ]);
    expect(http.bodies[0].tool_choice).toBe('required');
    expect(http.bodies[0].messages).toEqual([
      { role: 'user', content: 'u' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c0', type: 'function', function: { name: 'sum', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c0', content: '{"r":1}' },
    ]);
    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'sum', arguments: '{"a":1}' }]);
  });

  it('sin texto ni herramientas sigue siendo una respuesta vacía (error)', async () => {
    const http = fakeHttp({ choices: [{ message: { content: '' }, finish_reason: 'stop' }], usage });
    await expect(
      new OpenRouterLlmProvider(http, 1).complete({ model: 'm', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow('Respuesta vacía');
  });

  it('con herramientas, una respuesta vacía no es un fallo (no se reintenta ni abre el circuito)', async () => {
    const http = fakeHttp({ choices: [{ message: { content: '' }, finish_reason: 'stop' }], usage });
    const response = await new OpenRouterLlmProvider(http, 1).complete({
      model: 'm',
      messages: [{ role: 'user', content: 'u' }],
      tools: [{ name: 'sum', description: 'Suma', parameters: { type: 'object' } }],
    });
    expect(response).toMatchObject({ content: '' });
    expect(response.toolCalls).toBeUndefined();
  });
});

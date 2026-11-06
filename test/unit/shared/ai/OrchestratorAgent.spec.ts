import { z } from 'zod';
import {
  AgentSettings,
  AgentTool,
  BaseAgent,
  ChatMessage,
  FINAL_ANSWER_TOOL,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  OrchestratorAgent,
  SubAgentTool,
  ToolCall,
} from '@/shared/ai';
import { AppConfig, parseEnv } from '@/shared/config';

const settings = (env: Record<string, string> = {}) =>
  new AgentSettings(
    new AppConfig(parseEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d', RABBITMQ_URL: 'amqp://u:p@h:5672', ...env })),
  );

/** LLM falso con un guion por agente (según el nombre del schema o el primer mensaje del sistema). */
function routedLlm(scripts: Record<string, LlmResponse[]>): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: 'fake',
    requests,
    complete: (request: LlmRequest): Promise<LlmResponse> => {
      requests.push(request);
      const agent = request.messages[0].content;
      const next = scripts[agent]?.shift();
      if (!next) throw new Error(`Sin respuesta para ${agent}`);
      return Promise.resolve(next);
    },
  };
}

const usage = { promptTokens: 10, completionTokens: 5, cost: 0.01 };
const answer = (content: string): LlmResponse => ({ content, model: 'm', usage });
const calls = (...items: Array<[string, unknown]>): LlmResponse => ({
  content: '',
  model: 'm',
  usage,
  toolCalls: items.map(([name, args], index): ToolCall => ({ id: `c${index}`, name, arguments: JSON.stringify(args) })),
});

const HazardSchema = z.object({ hazards: z.array(z.string()) });

/** Subagente simple (un BaseAgent): identifica peligros. */
class HazardAgent extends BaseAgent<{ cas: string }, z.infer<typeof HazardSchema>> {
  readonly name = 'hazards';
  readonly promptVersion = 'hazards.v1';
  protected readonly outputSchema = HazardSchema;
  constructor(llm: LlmProvider, agentSettings: AgentSettings) {
    super(llm, agentSettings);
  }
  protected buildMessages(input: { cas: string }): ChatMessage[] {
    return [
      { role: 'system', content: 'hazards' },
      { role: 'user', content: input.cas },
    ];
  }
}

const ReportSchema = z.object({ summary: z.string() });

class SafetyOrchestrator extends OrchestratorAgent<string, z.infer<typeof ReportSchema>> {
  readonly name = 'safety-orchestrator';
  readonly promptVersion = 'safety.v1';
  protected readonly outputSchema = ReportSchema;
  constructor(
    llm: LlmProvider,
    agentSettings: AgentSettings,
    private readonly team: readonly AgentTool[],
  ) {
    super(llm, agentSettings);
  }
  protected subAgents(): readonly AgentTool[] {
    return this.team;
  }
  protected buildMessages(input: string): ChatMessage[] {
    return [
      { role: 'system', content: 'orchestrator' },
      { role: 'user', content: `${this.delegationGuide(input)}\n${input}` },
    ];
  }
}

const hazardTool = (agent: HazardAgent) =>
  new SubAgentTool({
    name: 'delegate_hazards',
    description: 'Identifica los peligros de un CAS',
    inputSchema: z.object({ cas: z.string() }),
    agent,
  });

describe('OrchestratorAgent + SubAgentTool', () => {
  it('delega en sus subagentes, recibe solo su resultado y suma el uso de todos', async () => {
    const llm = routedLlm({
      orchestrator: [
        calls(['delegate_hazards', { cas: '67-64-1' }], ['delegate_hazards', { cas: '64-17-5' }]),
        calls([FINAL_ANSWER_TOOL, { summary: 'Inflamables' }]),
      ],
      hazards: [answer('{"hazards":["H225"]}'), answer('{"hazards":["H225","H319"]}')],
    });
    const config = settings();
    const orchestrator = new SafetyOrchestrator(llm, config, [hazardTool(new HazardAgent(llm, config))]);

    const result = await orchestrator.run('Resume los peligros');

    expect(result.output).toEqual({ summary: 'Inflamables' });
    // 2 llamadas del orquestador + 2 de los subagentes.
    expect(result.usage).toEqual({ promptTokens: 40, completionTokens: 20, cost: 0.04 });
    const orchestratorRequests = llm.requests.filter((request) => request.messages[0].content === 'orchestrator');
    const toolMessages = orchestratorRequests[1].messages.filter((message) => message.role === 'tool');
    expect(toolMessages.map((message) => message.content)).toEqual([
      '{"hazards":["H225"]}',
      '{"hazards":["H225","H319"]}',
    ]);
    // Los subagentes corren un nivel más abajo.
    expect(result.trace?.filter((entry) => entry.name === 'hazards').map((entry) => entry.depth)).toEqual([1, 1]);
    // La guía de delegación nombra al equipo.
    expect(llm.requests[0].messages[1].content).toContain('- delegate_hazards: Identifica los peligros de un CAS');
  });

  it('respeta la profundidad máxima (AI_AGENT_MAX_DEPTH): no delega y se lo dice al orquestador, que sigue', async () => {
    const llm = routedLlm({
      orchestrator: [calls(['delegate_hazards', { cas: '1' }]), calls([FINAL_ANSWER_TOOL, { summary: 'sin delegar' }])],
    });
    const config = settings({ AI_AGENT_MAX_DEPTH: '0' });
    const orchestrator = new SafetyOrchestrator(llm, config, [hazardTool(new HazardAgent(llm, config))]);

    const result = await orchestrator.run('x');
    expect(result.output.summary).toBe('sin delegar');
    const toolMessage = llm.requests[1].messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('profundidad máxima');
  });

  it('un subagente que falla vuelve como error y el orquestador puede seguir', async () => {
    const llm = routedLlm({
      orchestrator: [calls(['delegate_hazards', { cas: '1' }]), calls([FINAL_ANSWER_TOOL, { summary: 'sin datos' }])],
      hazards: [answer('no es json'), answer('tampoco')],
    });
    const config = settings();
    const orchestrator = new SafetyOrchestrator(llm, config, [hazardTool(new HazardAgent(llm, config))]);

    const result = await orchestrator.run('x');
    expect(result.output.summary).toBe('sin datos');
    const toolMessage = llm.requests[llm.requests.length - 1].messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toContain('ERROR');
  });
});

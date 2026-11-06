import { randomUUID } from 'node:crypto';
import { LlmUsage } from '@/shared/ai/contract';
import { AgentLimitError } from '@/shared/ai/agent/AgentErrors';
import { AgentTraceEntry } from '@/shared/ai/agent/RunnableAgent';

/** Límites de una ejecución (vienen de AgentSettings: AI_AGENT_MAX_STEPS, AI_AGENT_MAX_DEPTH, AI_AGENT_TOOL_TIMEOUT_MS). */
export interface AgentLimits {
  maxSteps: number;
  maxDepth: number;
  toolTimeoutMs: number;
}

/** Traza de toda la ejecución, compartida por el agente raíz y todos sus subagentes. */
class RunLedger {
  readonly trace: AgentTraceEntry[] = [];
}

/**
 * Contexto de una ejecución de agentes: identificador, nivel en el árbol (0 = el que se ejecutó primero), límites,
 * cancelación, uso y traza. Cada subagente corre con un hijo ({@link child}): su uso suma en él y en todos sus
 * ancestros, así el orquestador reporta el costo total de lo que delegó.
 */
export class AgentRunContext {
  private readonly ownUsage: LlmUsage = { promptTokens: 0, completionTokens: 0 };

  private constructor(
    readonly runId: string,
    readonly depth: number,
    readonly limits: AgentLimits,
    private readonly ledger: RunLedger,
    private readonly parent?: AgentRunContext,
    readonly signal?: AbortSignal,
  ) {}

  /** Contexto de una ejecución nueva (un agente que no corre dentro de otro). */
  static root(limits: AgentLimits, options: { runId?: string; signal?: AbortSignal } = {}): AgentRunContext {
    return new AgentRunContext(options.runId ?? randomUUID(), 0, limits, new RunLedger(), undefined, options.signal);
  }

  /** Contexto de un subagente: un nivel más abajo. Falla si pasaría la profundidad máxima. */
  child(): AgentRunContext {
    if (this.depth + 1 > this.limits.maxDepth) {
      throw new AgentLimitError(`Se alcanzó la profundidad máxima de subagentes (${this.limits.maxDepth})`);
    }
    return new AgentRunContext(this.runId, this.depth + 1, this.limits, this.ledger, this, this.signal);
  }

  /** Uso de este nivel y de todo lo que corrió debajo. */
  get usage(): LlmUsage {
    return { ...this.ownUsage };
  }

  get trace(): readonly AgentTraceEntry[] {
    return this.ledger.trace;
  }

  addUsage(usage: LlmUsage): void {
    this.ownUsage.promptTokens += usage.promptTokens;
    this.ownUsage.completionTokens += usage.completionTokens;
    if (usage.cost !== undefined) this.ownUsage.cost = (this.ownUsage.cost ?? 0) + usage.cost;
    this.parent?.addUsage(usage);
  }

  record(entry: Omit<AgentTraceEntry, 'depth'>): void {
    this.ledger.trace.push({ ...entry, depth: this.depth });
  }

  throwIfAborted(): void {
    if (this.signal?.aborted) throw new AgentLimitError('La ejecución del agente se canceló');
  }
}

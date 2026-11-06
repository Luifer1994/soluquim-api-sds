/** Un agente pasó un límite de su ejecución (pasos, profundidad de subagentes o tiempo). */
export class AgentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentLimitError';
  }
}

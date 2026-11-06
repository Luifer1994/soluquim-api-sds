import { ToolCallingAgent } from '@/shared/ai/agent/ToolCallingAgent';
import { AgentTool } from '@/shared/ai/agent/tool';

/**
 * Agente que coordina (patrón Template Method sobre {@link ToolCallingAgent}): no hace el trabajo experto, lo
 * DELEGA en sus subagentes ({@link SubAgentTool}) y une sus resultados. Cada subagente trabaja con su propio
 * contexto y devuelve solo su resultado, así el orquestador decide con información corta y cada especialista
 * rinde mejor en lo suyo. Además de los subagentes puede tener herramientas propias (RAG, consultas…).
 *
 * Cada orquestador define `subAgents(input)` (y opcionalmente `ownTools(input)`), y usa {@link delegationGuide} en
 * su prompt de sistema para que el modelo sepa a quién delegar cada tarea.
 */
export abstract class OrchestratorAgent<TInput, TOutput> extends ToolCallingAgent<TInput, TOutput> {
  /** Especialistas en los que delega en esta ejecución: cada uno es un {@link SubAgentTool}. */
  protected abstract subAgents(input: TInput): readonly AgentTool[];

  /** Herramientas propias, además de los subagentes. */
  protected ownTools(_input: TInput): readonly AgentTool[] {
    return [];
  }

  protected tools(input: TInput): readonly AgentTool[] {
    return [...this.subAgents(input), ...this.ownTools(input)];
  }

  /** Bloque para el prompt de sistema: cómo delegar y en quién. */
  protected delegationGuide(input: TInput): string {
    const team = this.subAgents(input)
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join('\n');
    return [
      '<delegation>',
      'Coordinas un equipo de especialistas. No hagas tú su trabajo: delega cada tarea en el especialista que',
      'corresponde, pasándole solo lo que necesita. Puedes llamar a varios en el mismo turno si sus tareas no',
      'dependen entre sí; si una depende de otra, espera su resultado. Revisa lo que devuelven y, si algo falta o',
      'se contradice, vuelve a delegar con una indicación precisa. Al terminar, une los resultados y entrega la',
      'respuesta final.',
      '',
      'Especialistas:',
      team,
      '</delegation>',
    ].join('\n');
  }
}

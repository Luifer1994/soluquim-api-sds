/** Tareas de RabbitMQ del módulo de sustancias (routing key `sds.*` → cola de este servicio). */
export const SourceTaskTypes = {
  /** Consultar UNA fuente lenta (modo background) para UN CAS y dejarla en el cache. */
  SOURCE_FETCH: 'sds.source.fetch',
  /**
   * Los datos de una fuente para un CAS son nuevos o cambiaron: hay que (re)vectorizarlos en la base de
   * conocimiento del agente. Lo atiende el módulo `knowledge`.
   */
  KNOWLEDGE_INDEX: 'sds.knowledge.index',
} as const;

export interface KnowledgeIndexPayload {
  cas: string;
  source: string;
}

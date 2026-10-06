/** Resultado de consultar una fuente. Mismos valores que el enum `source_status` de la BD. */
export enum SourceStatusEnum {
  /** La fuente devolvió datos. */
  OK = 'OK',
  /** La fuente respondió bien, pero no tiene esa sustancia. También se cachea. */
  NOT_FOUND = 'NOT_FOUND',
  /** Error, timeout o respuesta inválida tras agotar los reintentos. No se cachea. */
  FAILED = 'FAILED',
  /** La fuente viene fallando seguido: no se la llama por un rato (circuit breaker). */
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
  /**
   * Fuente lenta por diseño (p. ej. OSHA exige 10 s entre peticiones): se encargó al worker y el dato
   * estará en el cache en la próxima consulta. No se guarda en la BD.
   */
  PENDING = 'PENDING',
}

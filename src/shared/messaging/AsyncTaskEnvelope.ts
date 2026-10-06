/**
 * Mismo contrato JSON que `com.soluquim.commons.messaging.MessageContext` (Java).
 * Son DATOS del emisor, no un JWT firmado.
 */
export interface MessageContext {
  tenantId: string | null;
  userId: string | null;
  email: string | null;
  username: string | null;
  roles: string[] | null;
}

/**
 * Mismo contrato JSON que `com.soluquim.commons.messaging.AsyncTaskEnvelope` (Java): así un servicio
 * Java puede publicar tareas `sds.*` y este servicio puede publicar tareas para los Java (`ws.relay`).
 * No agregar campos: el formato lo define soluquim-commons.
 */
export interface AsyncTaskEnvelope<T = unknown> {
  /** Identificador de la tarea; también es la routing key. Formato `<dominio>.<acción>`. */
  taskType: string;
  payload: T;
  context: MessageContext | null;
  messageId: string;
  /** ISO-8601 (Java lo lee como `Instant`). */
  occurredAt: string;
}

/** Clase Java del sobre. Jackson2JsonMessageConverter la usa para deserializar en los consumidores Java. */
export const JAVA_ENVELOPE_TYPE_ID = 'com.soluquim.commons.messaging.AsyncTaskEnvelope';

/** Header AMQP con el id de correlación (el sobre no tiene campo para él). */
export const REQUEST_ID_HEADER = 'x-request-id';

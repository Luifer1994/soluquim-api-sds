import { SetMetadata } from '@nestjs/common';
import { ZodType } from 'zod';

export const ASYNC_TASK_HANDLER_KEY = 'soluquim:async-task-handler';

/**
 * Contrato de un consumidor de tareas — equivalente a `AsyncTaskHandler<T>` de soluquim-commons.
 *
 * - `taskType`: la routing key que atiende (debe empezar por `sds.` para llegar a la cola de este servicio).
 * - `payloadSchema`: valida y tipa el payload. Si no valida, el mensaje va directo a la DLQ (no se reintenta).
 * - `handle`: si lanza error, se reintenta con backoff; al agotarse, va a la DLQ.
 *   Debe ser IDEMPOTENTE: RabbitMQ puede entregar el mismo mensaje más de una vez.
 */
export interface AsyncTaskHandler<T = unknown> {
  readonly taskType: string;
  readonly payloadSchema: ZodType<T>;
  handle(payload: T): Promise<void>;
}

/** Marca un provider como handler de tareas. El dispatcher los descubre solo al arrancar. */
export const TaskHandler = () => SetMetadata(ASYNC_TASK_HANDLER_KEY, true);

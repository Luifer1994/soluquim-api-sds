import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '@/shared/config';
import { RequestContext } from '@/shared/context';
import { AmqpConnection } from '@/shared/messaging/AmqpConnection';
import {
  AsyncTaskEnvelope,
  JAVA_ENVELOPE_TYPE_ID,
  MessageContext,
  REQUEST_ID_HEADER,
} from '@/shared/messaging/AsyncTaskEnvelope';

/**
 * Publica tareas en el exchange compartido `soluquim.tasks`. El `taskType` es la routing key.
 * Captura el contexto actual (tenant/usuario) y lo adjunta al sobre, igual que el publisher de Java.
 */
@Injectable()
export class AsyncTaskPublisher {
  private readonly logger = new Logger(AsyncTaskPublisher.name);

  constructor(
    private readonly amqp: AmqpConnection,
    private readonly config: AppConfig,
  ) {}

  /** Resuelve cuando RabbitMQ confirma la recepción (publisher confirms). */
  async publish<T>(taskType: string, payload: T): Promise<string> {
    const envelope: AsyncTaskEnvelope<T> = {
      taskType,
      payload,
      context: this.captureContext(),
      messageId: randomUUID(),
      occurredAt: new Date().toISOString(),
    };

    await this.amqp.publishChannel.publish(
      this.config.messaging.exchange,
      taskType,
      Buffer.from(JSON.stringify(envelope)),
      {
        contentType: 'application/json',
        contentEncoding: 'UTF-8',
        persistent: true,
        messageId: envelope.messageId,
        timestamp: Math.floor(Date.now() / 1000),
        headers: {
          __TypeId__: JAVA_ENVELOPE_TYPE_ID,
          [REQUEST_ID_HEADER]: RequestContext.requestId,
        },
      },
    );

    this.logger.log(`Tarea publicada '${taskType}' (messageId=${envelope.messageId})`);
    return envelope.messageId;
  }

  private captureContext(): MessageContext {
    const ctx = RequestContext.current();
    return {
      tenantId: ctx?.tenantId ?? null,
      userId: ctx?.userId ?? null,
      email: ctx?.email ?? null,
      username: ctx?.username ?? null,
      roles: ctx?.roles ?? null,
    };
  }
}

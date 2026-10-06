import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { AppConfig } from '@/shared/config';
import { RequestContext } from '@/shared/context';
import { AmqpConnection } from '@/shared/messaging/AmqpConnection';
import { AsyncTaskEnvelope, REQUEST_ID_HEADER } from '@/shared/messaging/AsyncTaskEnvelope';
import { ASYNC_TASK_HANDLER_KEY, AsyncTaskHandler } from '@/shared/messaging/AsyncTaskHandler';

/**
 * Consumidor único de `soluquim.sds.tasks.q` — equivalente a `AsyncTaskDispatcher` de soluquim-commons:
 * restaura el contexto del emisor, enruta por `taskType` y aplica la misma política de errores.
 *
 *  - Sobre inválido, sin handler o payload que no valida → DLQ sin reintentar (reintentar no lo arregla).
 *  - El handler lanza error → reintento en proceso con backoff exponencial; al agotarse → DLQ.
 *
 * Solo lo arranca el proceso worker (`main.worker.ts`). La API publica pero nunca consume.
 */
@Injectable()
export class AsyncTaskDispatcher implements OnApplicationShutdown {
  private readonly logger = new Logger(AsyncTaskDispatcher.name);
  private readonly handlers = new Map<string, AsyncTaskHandler>();
  private channel?: ChannelWrapper;
  private readonly inFlight = new Set<Promise<void>>();
  private stopping = false;

  constructor(
    private readonly amqp: AmqpConnection,
    private readonly config: AppConfig,
    private readonly discovery: DiscoveryService,
  ) {}

  async start(): Promise<void> {
    if (this.config.process !== 'worker') {
      throw new Error('El dispatcher solo puede arrancar en el proceso worker (SDS_PROCESS=worker)');
    }
    this.registerHandlers();
    const { queue, concurrency } = this.config.messaging;

    this.channel = this.amqp.createConsumerChannel(async (channel: ConfirmChannel) => {
      await channel.prefetch(concurrency);
      await channel.consume(queue, (message) => message && this.track(this.onMessage(channel, message)), {
        noAck: false,
      });
    });
    await this.channel.waitForConnect();
    this.logger.log(
      `Consumiendo '${queue}' (prefetch=${concurrency}) — handlers: [${[...this.handlers.keys()].join(', ')}]`,
    );
  }

  private registerHandlers(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as AsyncTaskHandler | undefined;
      if (!instance || !wrapper.metatype || !Reflect.getMetadata(ASYNC_TASK_HANDLER_KEY, wrapper.metatype)) continue;

      const previous = this.handlers.get(instance.taskType);
      if (previous) {
        throw new Error(
          `Handler duplicado para '${instance.taskType}': ${previous.constructor.name} y ${instance.constructor.name}`,
        );
      }
      this.handlers.set(instance.taskType, instance);
    }
  }

  private track(work: Promise<void>): void {
    this.inFlight.add(work);
    void work.finally(() => this.inFlight.delete(work));
  }

  private async onMessage(channel: ConfirmChannel, message: ConsumeMessage): Promise<void> {
    const envelope = this.parse(message);
    if (!envelope) {
      this.logger.error('Sobre inválido o sin taskType — a la DLQ');
      return channel.nack(message, false, false);
    }

    const handler = this.handlers.get(envelope.taskType);
    if (!handler) {
      this.logger.error(`Sin handler para '${envelope.taskType}' (messageId=${envelope.messageId}) — a la DLQ`);
      return channel.nack(message, false, false);
    }

    const payload = handler.payloadSchema.safeParse(envelope.payload);
    if (!payload.success) {
      this.logger.error(`Payload inválido para '${envelope.taskType}' (messageId=${envelope.messageId}) — a la DLQ`);
      return channel.nack(message, false, false);
    }

    const requestId = String(message.properties.headers?.[REQUEST_ID_HEADER] ?? envelope.messageId ?? randomUUID());
    const ok = await RequestContext.run(
      {
        requestId,
        tenantId: envelope.context?.tenantId ?? undefined,
        userId: envelope.context?.userId ?? undefined,
        username: envelope.context?.username ?? undefined,
        email: envelope.context?.email ?? undefined,
        roles: envelope.context?.roles ?? [],
        permissions: [],
        language: 'es',
      },
      () => this.handleWithRetry(handler, payload.data, envelope),
    );

    if (ok) channel.ack(message);
    else channel.nack(message, false, false);
  }

  private async handleWithRetry(
    handler: AsyncTaskHandler,
    payload: unknown,
    envelope: AsyncTaskEnvelope,
  ): Promise<boolean> {
    const { maxAttempts, initialBackoffMs, backoffMultiplier, maxBackoffMs } = this.config.messaging;
    let delay = initialBackoffMs;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.log(
          `Procesando '${envelope.taskType}' con ${handler.constructor.name} (intento ${attempt}/${maxAttempts})`,
        );
        await handler.handle(payload);
        return true;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const last = attempt === maxAttempts || this.stopping;
        this.logger.error(
          `'${envelope.taskType}' falló (intento ${attempt}/${maxAttempts}): ${err.message}`,
          err.stack,
        );
        if (last) {
          this.logger.error(`'${envelope.taskType}' agotó los reintentos (messageId=${envelope.messageId}) — a la DLQ`);
          return false;
        }
        await sleep(delay);
        delay = Math.min(delay * backoffMultiplier, maxBackoffMs);
      }
    }
    return false;
  }

  private parse(message: ConsumeMessage): AsyncTaskEnvelope | null {
    try {
      const envelope = JSON.parse(message.content.toString('utf8')) as AsyncTaskEnvelope;
      return typeof envelope?.taskType === 'string' && envelope.taskType ? envelope : null;
    } catch {
      return null;
    }
  }

  /** Deja de recibir y espera a que terminen los mensajes en curso antes de cerrar. */
  async onApplicationShutdown(): Promise<void> {
    if (!this.channel) return;
    this.stopping = true;
    await this.channel.cancelAll().catch(() => undefined);
    await Promise.allSettled([...this.inFlight]);
    await this.channel.close().catch(() => undefined);
  }
}

import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import amqp, { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel } from 'amqplib';
import { AppConfig, MessagingConfig } from '@/shared/config';

/**
 * Conexión única a RabbitMQ con reconexión automática. Declara la topología de forma idempotente
 * en cada (re)conexión — los mismos parámetros que `CommonsMessagingAutoConfiguration` (Java), o
 * RabbitMQ rechazaría la declaración por argumentos distintos.
 */
@Injectable()
export class AmqpConnection implements OnApplicationShutdown {
  private readonly logger = new Logger(AmqpConnection.name);
  private readonly connection: AmqpConnectionManager;
  private readonly config: MessagingConfig;
  readonly publishChannel: ChannelWrapper;

  constructor(appConfig: AppConfig) {
    this.config = appConfig.messaging;
    this.connection = amqp.connect([this.config.url], {
      heartbeatIntervalInSeconds: 30,
      reconnectTimeInSeconds: 5,
      connectionOptions: { clientProperties: { connection_name: 'soluquim-api-sds' } },
    });
    this.connection.on('connect', () => this.logger.log('Conectado a RabbitMQ'));
    this.connection.on('disconnect', ({ err }) =>
      this.logger.warn(`Desconectado de RabbitMQ: ${err?.message ?? 'sin detalle'}`),
    );

    this.publishChannel = this.connection.createChannel({
      name: 'sds-publish',
      confirm: true,
      setup: (channel: ConfirmChannel) => this.assertTopology(channel),
    });
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  createConsumerChannel(setup: (channel: ConfirmChannel) => Promise<void>): ChannelWrapper {
    return this.connection.createChannel({
      name: 'sds-consume',
      confirm: true,
      setup: async (channel: ConfirmChannel) => {
        await this.assertTopology(channel);
        await setup(channel);
      },
    });
  }

  async assertTopology(channel: ConfirmChannel): Promise<void> {
    const c = this.config;
    await channel.assertExchange(c.exchange, 'topic', { durable: true, autoDelete: false });
    await channel.assertExchange(c.deadLetterExchange, 'topic', { durable: true, autoDelete: false });
    await channel.assertQueue(c.deadLetterQueue, { durable: true });
    await channel.bindQueue(c.deadLetterQueue, c.deadLetterExchange, '#');
    await channel.assertQueue(c.queue, { durable: true, deadLetterExchange: c.deadLetterExchange });
    await channel.bindQueue(c.queue, c.exchange, c.bindingPattern);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.publishChannel.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }
}

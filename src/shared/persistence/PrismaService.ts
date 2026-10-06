import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from '@/shared/config';

/** Cliente de la BD PROPIA del servicio (sds-postgres). Ningún otro servicio comparte estas tablas. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({
      datasourceUrl: config.databaseUrl,
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    this.$on('warn' as never, (event: { message: string }) => this.logger.warn(event.message));
    this.$on('error' as never, (event: { message: string }) => this.logger.error(event.message));
    await this.$connect();
    this.logger.log('Conectado a la base de datos SDS');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Para el health check: `true` si la BD responde. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

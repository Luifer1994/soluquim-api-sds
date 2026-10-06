import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AmqpConnection } from '@/shared/messaging';
import { PrismaService } from '@/shared/persistence';
import { Result } from '@/shared/util';

interface HealthStatus {
  status: 'UP' | 'DOWN';
  components: { database: 'UP' | 'DOWN'; rabbitmq: 'UP' | 'DOWN' };
}

@ApiTags('Health')
@Controller('v1/health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly amqp: AmqpConnection,
  ) {}

  /** Liveness: el proceso responde. Lo usa el healthcheck de Docker. */
  @Get('live')
  @ApiOperation({ summary: 'Liveness' })
  live(): Result<{ status: 'UP' }> {
    return Result.success({ status: 'UP' }, 'Servicio activo');
  }

  /** Readiness: BD propia y RabbitMQ disponibles. */
  @Get()
  @ApiOperation({ summary: 'Readiness (BD + RabbitMQ)' })
  async ready(): Promise<Result<HealthStatus>> {
    const database = (await this.prisma.isHealthy()) ? 'UP' : 'DOWN';
    const rabbitmq = this.amqp.isConnected() ? 'UP' : 'DOWN';
    const status = database === 'UP' && rabbitmq === 'UP' ? 'UP' : 'DOWN';
    const body: HealthStatus = { status, components: { database, rabbitmq } };

    return status === 'UP'
      ? Result.success(body, 'Servicio disponible')
      : Result.failure('SERVICE_UNAVAILABLE', 'Servicio no disponible', HttpStatus.SERVICE_UNAVAILABLE, body);
  }
}

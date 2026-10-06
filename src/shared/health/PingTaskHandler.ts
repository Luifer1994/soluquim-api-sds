import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '@/shared/context';
import { AsyncTaskHandler, TaskHandler } from '@/shared/messaging';

const PingPayloadSchema = z.object({ message: z.string().max(500).optional() }).loose();

type PingPayload = z.infer<typeof PingPayloadSchema>;

/**
 * `sds.ping`: prueba de punta a punta de la mensajería. Cualquier servicio (Java o Node) puede
 * publicarla en `soluquim.tasks` y debe verse en el log del worker con el tenant/usuario del emisor.
 */
@Injectable()
@TaskHandler()
export class PingTaskHandler implements AsyncTaskHandler<PingPayload> {
  readonly taskType = 'sds.ping';
  readonly payloadSchema = PingPayloadSchema;
  private readonly logger = new Logger(PingTaskHandler.name);

  async handle(payload: PingPayload): Promise<void> {
    this.logger.log(
      `pong — message="${payload.message ?? ''}" tenant=${RequestContext.tenantId ?? '-'} user=${RequestContext.userId ?? '-'}`,
    );
  }
}

import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AsyncTaskHandler, TaskHandler } from '@/shared/messaging';
import { SdsTaskTypes } from '@/modules/sds/sdsgeneration/messaging/SdsTaskTypes';
import { RunSdsGenerationService } from '@/modules/sds/sdsgeneration/service/RunSdsGenerationService';

/**
 * Worker: genera la FDS de un job. No relanza errores: el servicio deja el job en FAILED con el motivo
 * (reintentar en automático una generación con IA solo gastaría tokens repitiendo el mismo fallo).
 */
@Injectable()
@TaskHandler()
export class SdsGenerationRequestedHandler implements AsyncTaskHandler<{ jobId: string }> {
  readonly taskType = SdsTaskTypes.GENERATION_REQUESTED;
  readonly payloadSchema = z.object({ jobId: z.uuid() });

  constructor(private readonly run: RunSdsGenerationService) {}

  async handle({ jobId }: { jobId: string }): Promise<void> {
    await this.run.execute({ jobId });
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { RequestContext } from '@/shared/context';
import { Result } from '@/shared/util';
import { SdsGenerationJobResponseDTO } from '@/modules/sds/sdsgeneration/dto/response';
import { SdsGenerationJobRepository } from '@/modules/sds/sdsgeneration/repository';

/** Una generación tarda 1-2 minutos; si lleva más de esto "en curso", el worker la abandonó. */
const STALE_AFTER_MS = 15 * 60_000;

@Injectable()
export class GetSdsGenerationJobService extends BaseService<{ jobId: string }, SdsGenerationJobResponseDTO> {
  constructor(private readonly jobs: SdsGenerationJobRepository) {
    super();
  }

  async execute({ jobId }: { jobId: string }): Promise<Result<SdsGenerationJobResponseDTO>> {
    try {
      // Vigilante: un job abandonado (worker reiniciado o caído) no debe quedar "en curso" para siempre.
      const abandoned = await this.jobs.failIfStale(
        jobId,
        new Date(Date.now() - STALE_AFTER_MS),
        'La generación no terminó: el proceso que la ejecutaba se detuvo. Vuelve a generarla.',
      );
      if (abandoned) this.logger.warn(`Job ${jobId} marcado FAILED: llevaba más de 15 min sin terminar`);
      const job = await this.jobs.findById(jobId);
      if (!job || job.tenantId !== RequestContext.tenantIdOrDefault) {
        return Result.failure('JOB_NOT_FOUND', 'Generación no encontrada', HttpStatus.NOT_FOUND);
      }
      return Result.success({
        jobId: job.id,
        status: job.status,
        documentId: job.documentId,
        progress: job.progress,
        error: job.error,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      });
    } catch (error) {
      return this.handleException('GetSdsGenerationJob', error);
    }
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { AiStatus } from '@/shared/ai';
import { BaseService } from '@/shared/base';
import { RequestContext } from '@/shared/context';
import { AsyncTaskPublisher } from '@/shared/messaging';
import { contentHash, Result } from '@/shared/util';
import { MixtureNormalizer } from '@/modules/sds/sdsmixture/normalizer';
import { GenerateSdsRequestDTO } from '@/modules/sds/sdsgeneration/dto/request';
import { SdsTaskTypes } from '@/modules/sds/sdsgeneration/messaging/SdsTaskTypes';
import { SdsGenerationJobRepository } from '@/modules/sds/sdsgeneration/repository';

/**
 * API: pide la generación de una FDS. No la genera aquí (tarda ~1 min): crea el job, lo encarga al
 * worker por RabbitMQ y responde 202 con el `jobId` para consultar el avance.
 */
@Injectable()
export class RequestSdsGenerationService extends BaseService<GenerateSdsRequestDTO, { jobId: string; status: string }> {
  constructor(
    private readonly jobs: SdsGenerationJobRepository,
    private readonly publisher: AsyncTaskPublisher,
    private readonly ai: AiStatus,
  ) {
    super();
  }

  async execute(request: GenerateSdsRequestDTO): Promise<Result<{ jobId: string; status: string }>> {
    if (!this.ai.enabled) {
      return Result.failure(
        'AI_DISABLED',
        `La IA no está configurada (proveedor "${this.ai.provider}"): falta la clave en soluquim-api-sds/.env`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      const mixture = MixtureNormalizer.normalize(request.components);
      const normalized = { ...request, components: mixture.components };
      const job = await this.jobs.create({
        tenantId: RequestContext.tenantIdOrDefault,
        mixtureKey: contentHash({
          components: mixture.components,
          language: request.language,
          country: request.destinationCountry,
        }),
        request: normalized,
        requestedBy: RequestContext.userId,
      });
      await this.publisher.publish(SdsTaskTypes.GENERATION_REQUESTED, { jobId: job.id });
      return Result.accepted({ jobId: job.id, status: job.status }, 'Generación de la FDS en curso');
    } catch (error) {
      return this.handleException('RequestSdsGeneration', error);
    }
  }
}

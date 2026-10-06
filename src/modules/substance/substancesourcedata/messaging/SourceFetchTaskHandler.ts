import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AsyncTaskHandler, TaskHandler } from '@/shared/messaging';
import { CasNumberSchema } from '@/shared/validation';
import { SourceCodeEnum } from '@/modules/source';
import { SourceFetchPayload } from '@/modules/substance/substancesourcedata/messaging/SourceFetchScheduler';
import { SourceTaskTypes } from '@/modules/substance/substancesourcedata/messaging/SourceTaskTypes';
import { CollectSubstanceDataService } from '@/modules/substance/substancesourcedata/service/CollectSubstanceDataService';

const PayloadSchema = z.object({
  cas: CasNumberSchema,
  source: z.enum(SourceCodeEnum),
  refresh: z.boolean().default(false),
});

/**
 * Worker: consulta una fuente lenta para un CAS y la deja en el cache. Idempotente: si el dato ya
 * está vigente (otro mensaje llegó antes), no vuelve a llamar a la fuente.
 */
@Injectable()
@TaskHandler()
export class SourceFetchTaskHandler implements AsyncTaskHandler<SourceFetchPayload> {
  readonly taskType = SourceTaskTypes.SOURCE_FETCH;
  readonly payloadSchema = PayloadSchema;
  private readonly logger = new Logger(SourceFetchTaskHandler.name);

  constructor(
    @Inject(forwardRef(() => CollectSubstanceDataService))
    private readonly collect: CollectSubstanceDataService,
  ) {}

  async handle({ cas, source, refresh }: SourceFetchPayload): Promise<void> {
    const result = await this.collect.execute({ cas, refresh, sources: [source], runBackgroundSources: true });
    if (!result.isSuccess) throw new Error(result.message);
    const status = result.data?.sources[0]?.status;
    this.logger.log(`${source} para ${cas}: ${status}`);
  }
}

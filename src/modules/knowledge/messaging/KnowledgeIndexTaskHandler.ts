import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AsyncTaskHandler, TaskHandler } from '@/shared/messaging';
import { CasNumberSchema } from '@/shared/validation';
import { KnowledgeIndexPayload, SourceTaskTypes } from '@/modules/substance';
import { IndexSubstanceKnowledgeService } from '@/modules/knowledge/service';

/** Worker: los datos de una fuente cambiaron → re-vectorizar esa fuente para ese CAS. Idempotente. */
@Injectable()
@TaskHandler()
export class KnowledgeIndexTaskHandler implements AsyncTaskHandler<KnowledgeIndexPayload> {
  readonly taskType = SourceTaskTypes.KNOWLEDGE_INDEX;
  readonly payloadSchema = z.object({ cas: CasNumberSchema, source: z.string().min(1) });
  private readonly logger = new Logger(KnowledgeIndexTaskHandler.name);

  constructor(private readonly index: IndexSubstanceKnowledgeService) {}

  async handle({ cas, source }: KnowledgeIndexPayload): Promise<void> {
    const result = await this.index.execute({ cas, sources: [source] });
    if (!result.isSuccess || !result.data) throw new Error(result.message);
    const { created, updated, removed, embedded, pendingEmbedding } = result.data;
    this.logger.log(
      `Conocimiento ${source}/${cas}: +${created} ~${updated} -${removed}, vectorizados ${embedded}, pendientes ${pendingEmbedding}`,
    );
  }
}

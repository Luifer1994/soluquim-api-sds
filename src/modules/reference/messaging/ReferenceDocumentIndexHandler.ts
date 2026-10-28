import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AsyncTaskHandler, TaskHandler } from '@/shared/messaging';
import { ReferenceTaskTypes } from '@/modules/reference/messaging/ReferenceTaskTypes';
import { IndexReferenceDocumentService } from '@/modules/reference/service/IndexReferenceDocumentService';

/**
 * Worker: extrae, fragmenta y vectoriza un documento de referencia. No relanza errores: el servicio deja el
 * documento en FAILED con el motivo (un PDF ilegible fallaría igual en cada reintento).
 */
@Injectable()
@TaskHandler()
export class ReferenceDocumentIndexHandler implements AsyncTaskHandler<{ documentId: string }> {
  readonly taskType = ReferenceTaskTypes.INDEX_REQUESTED;
  readonly payloadSchema = z.object({ documentId: z.uuid() });

  constructor(private readonly index: IndexReferenceDocumentService) {}

  async handle({ documentId }: { documentId: string }): Promise<void> {
    await this.index.execute({ documentId });
  }
}

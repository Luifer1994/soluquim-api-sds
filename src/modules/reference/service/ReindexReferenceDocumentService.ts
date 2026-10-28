import { HttpStatus, Injectable } from '@nestjs/common';
import { ReferenceDocumentStatus } from '@prisma/client';
import { BaseService } from '@/shared/base';
import { RequestContext } from '@/shared/context';
import { AsyncTaskPublisher } from '@/shared/messaging';
import { Result } from '@/shared/util';
import { ReferenceDocumentResponseDTO } from '@/modules/reference/dto/response';
import { ReferenceDocumentMapper } from '@/modules/reference/mapper';
import { ReferenceTaskTypes } from '@/modules/reference/messaging/ReferenceTaskTypes';
import { ReferenceDocumentRepository } from '@/modules/reference/repository';

/**
 * Vuelve a indexar un documento desde su archivo: tras un fallo, si se subió sin IA activa, o si cambió la
 * forma de fragmentar. Uno que se está indexando no se toca.
 */
@Injectable()
export class ReindexReferenceDocumentService extends BaseService<{ id: string }, ReferenceDocumentResponseDTO> {
  constructor(
    private readonly documents: ReferenceDocumentRepository,
    private readonly publisher: AsyncTaskPublisher,
  ) {
    super();
  }

  async execute({ id }: { id: string }): Promise<Result<ReferenceDocumentResponseDTO>> {
    try {
      const document = await this.documents.findAccessible(id, RequestContext.tenantIdOrDefault);
      if (!document) {
        return Result.failure('REFERENCE_DOCUMENT_NOT_FOUND', 'Documento no encontrado', HttpStatus.NOT_FOUND);
      }
      if (document.status === ReferenceDocumentStatus.PROCESSING) {
        return Result.failure('REFERENCE_DOCUMENT_BUSY', 'El documento se está indexando', HttpStatus.CONFLICT);
      }
      const queued = await this.documents.requeue(id);
      await this.publisher.publish(ReferenceTaskTypes.INDEX_REQUESTED, { documentId: id });
      return Result.accepted(ReferenceDocumentMapper.toResponse(queued), 'Documento en cola para indexar');
    } catch (error) {
      return this.handleException('ReindexReferenceDocument', error);
    }
  }
}

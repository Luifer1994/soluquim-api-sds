import { HttpStatus, Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { RequestContext } from '@/shared/context';
import { Result } from '@/shared/util';
import { ReferenceDocumentRepository } from '@/modules/reference/repository';

export interface ReferenceDocumentFileDTO {
  fileName: string;
  mimeType: string;
  content: Buffer;
}

/** El archivo original, para descargarlo o verlo. */
@Injectable()
export class DownloadReferenceDocumentService extends BaseService<{ id: string }, ReferenceDocumentFileDTO> {
  constructor(private readonly documents: ReferenceDocumentRepository) {
    super();
  }

  async execute({ id }: { id: string }): Promise<Result<ReferenceDocumentFileDTO>> {
    try {
      const document = await this.documents.findAccessible(id, RequestContext.tenantIdOrDefault);
      const content = document ? await this.documents.findFile(id) : null;
      if (!document || !content) {
        return Result.failure('REFERENCE_DOCUMENT_NOT_FOUND', 'Documento no encontrado', HttpStatus.NOT_FOUND);
      }
      return Result.success({ fileName: document.fileName, mimeType: document.mimeType, content });
    } catch (error) {
      return this.handleException('DownloadReferenceDocument', error);
    }
  }
}

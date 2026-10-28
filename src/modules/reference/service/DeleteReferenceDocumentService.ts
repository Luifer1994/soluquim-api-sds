import { HttpStatus, Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { RequestContext } from '@/shared/context';
import { Result } from '@/shared/util';
import { ReferenceDocumentRepository } from '@/modules/reference/repository';

/**
 * Borra el documento con su archivo y sus fragmentos: deja de consultarse en las generaciones nuevas. Las
 * FDS ya generadas conservan sus citas (guardan el título y la página, no el fragmento).
 */
@Injectable()
export class DeleteReferenceDocumentService extends BaseService<{ id: string }, void> {
  constructor(private readonly documents: ReferenceDocumentRepository) {
    super();
  }

  async execute({ id }: { id: string }): Promise<Result<void>> {
    try {
      if (!(await this.documents.findAccessible(id, RequestContext.tenantIdOrDefault))) {
        return Result.failure('REFERENCE_DOCUMENT_NOT_FOUND', 'Documento no encontrado', HttpStatus.NOT_FOUND);
      }
      await this.documents.delete(id);
      return Result.success(undefined, 'Documento eliminado');
    } catch (error) {
      return this.handleException('DeleteReferenceDocument', error);
    }
  }
}

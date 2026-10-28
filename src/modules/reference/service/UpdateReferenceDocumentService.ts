import { HttpStatus, Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { RequestContext } from '@/shared/context';
import { Result } from '@/shared/util';
import { DOCUMENT_CATEGORIES_BY_SCOPE, UpdateReferenceDocumentDTO } from '@/modules/reference/dto/request';
import { ReferenceDocumentResponseDTO } from '@/modules/reference/dto/response';
import { ReferenceDocumentMapper } from '@/modules/reference/mapper';
import { ReferenceDocumentRepository } from '@/modules/reference/repository';

/** Cambia los datos descriptivos (título, categoría, secciones…). El archivo y sus fragmentos no cambian. */
@Injectable()
export class UpdateReferenceDocumentService extends BaseService<
  { id: string } & UpdateReferenceDocumentDTO,
  ReferenceDocumentResponseDTO
> {
  constructor(private readonly documents: ReferenceDocumentRepository) {
    super();
  }

  async execute({
    id,
    ...changes
  }: { id: string } & UpdateReferenceDocumentDTO): Promise<Result<ReferenceDocumentResponseDTO>> {
    try {
      const document = await this.documents.findAccessible(id, RequestContext.tenantIdOrDefault);
      if (!document) {
        return Result.failure('REFERENCE_DOCUMENT_NOT_FOUND', 'Documento no encontrado', HttpStatus.NOT_FOUND);
      }
      if (changes.category && !DOCUMENT_CATEGORIES_BY_SCOPE[document.scope].includes(changes.category)) {
        return Result.failure(
          'REFERENCE_DOCUMENT_CATEGORY_INVALID',
          'Esa categoría no corresponde al alcance del documento',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const updated = await this.documents.update(id, changes);
      return Result.success(ReferenceDocumentMapper.toResponse(updated), 'Documento actualizado');
    } catch (error) {
      return this.handleException('UpdateReferenceDocument', error);
    }
  }
}

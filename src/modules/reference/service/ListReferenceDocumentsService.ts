import { Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { RequestContext } from '@/shared/context';
import { Result } from '@/shared/util';
import { ListReferenceDocumentsQueryDTO } from '@/modules/reference/dto/request';
import { ReferenceDocumentResponseDTO } from '@/modules/reference/dto/response';
import { ReferenceDocumentMapper } from '@/modules/reference/mapper';
import { ReferenceDocumentRepository } from '@/modules/reference/repository';

/**
 * Documentos cargados, por categoría y título, con su estado de indexación: la biblioteca, o los documentos
 * de producto pedidos por id (la pantalla de generación sigue así el avance de los que adjuntó).
 */
@Injectable()
export class ListReferenceDocumentsService extends BaseService<
  ListReferenceDocumentsQueryDTO,
  ReferenceDocumentResponseDTO[]
> {
  constructor(private readonly documents: ReferenceDocumentRepository) {
    super();
  }

  async execute(query: ListReferenceDocumentsQueryDTO): Promise<Result<ReferenceDocumentResponseDTO[]>> {
    try {
      return Result.success(
        (await this.documents.findAll({ ...query, tenantId: RequestContext.tenantIdOrDefault })).map((document) =>
          ReferenceDocumentMapper.toResponse(document),
        ),
      );
    } catch (error) {
      return this.handleException('ListReferenceDocuments', error);
    }
  }
}

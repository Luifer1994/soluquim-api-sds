import { HttpStatus, Injectable } from '@nestjs/common';
import { ReferenceDocumentCategory, ReferenceDocumentScope } from '@prisma/client';
import { createHash } from 'node:crypto';
import { BaseService } from '@/shared/base';
import { AppConfig } from '@/shared/config';
import { RequestContext } from '@/shared/context';
import { AsyncTaskPublisher } from '@/shared/messaging';
import { Result } from '@/shared/util';
import { UploadedReferenceFile, UploadReferenceDocumentDTO } from '@/modules/reference/dto/request';
import { ReferenceDocumentResponseDTO } from '@/modules/reference/dto/response';
import { DocumentTextExtractorRegistry } from '@/modules/reference/extractor';
import { ReferenceDocumentMapper } from '@/modules/reference/mapper';
import { ReferenceTaskTypes } from '@/modules/reference/messaging/ReferenceTaskTypes';
import { ReferenceDocumentRepository } from '@/modules/reference/repository';

export interface UploadReferenceDocumentInput {
  file?: UploadedReferenceFile;
  metadata: UploadReferenceDocumentDTO;
}

/**
 * API: recibe un documento, guarda el original y lo encarga al worker para indexarlo. Responde 202: el
 * documento queda PENDING y la pantalla sigue su avance.
 *  - Biblioteca (LIBRARY): SGA, GRE, procedimientos… de toda la plataforma. Un archivo repetido es un error.
 *  - Documento del producto (PRODUCT): FDS de una materia prima, de un análogo… de la empresa. Si ese mismo
 *    archivo ya se subió para el mismo componente se reutiliza (ya está indexado): responde 200 con él.
 */
@Injectable()
export class UploadReferenceDocumentService extends BaseService<
  UploadReferenceDocumentInput,
  ReferenceDocumentResponseDTO
> {
  constructor(
    private readonly documents: ReferenceDocumentRepository,
    private readonly extractors: DocumentTextExtractorRegistry,
    private readonly publisher: AsyncTaskPublisher,
    private readonly config: AppConfig,
  ) {
    super();
  }

  async execute({ file, metadata }: UploadReferenceDocumentInput): Promise<Result<ReferenceDocumentResponseDTO>> {
    if (!file?.buffer?.length) {
      return Result.failure('REFERENCE_FILE_REQUIRED', 'Adjunta un archivo', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    // multer entrega el nombre en latin1; los nombres con tildes vienen en UTF-8.
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    if (!this.extractors.forFile(fileName)) {
      return Result.failure(
        'REFERENCE_FILE_UNSUPPORTED',
        `Formato no soportado. Formatos aceptados: ${this.extractors.supportedExtensions().join(', ')}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (file.size > this.config.reference.maxUploadBytes) {
      return Result.failure(
        'REFERENCE_FILE_TOO_LARGE',
        `El archivo supera el máximo de ${Math.round(this.config.reference.maxUploadBytes / 1024 / 1024)} MB`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    try {
      const hash = createHash('sha256').update(file.buffer).digest('hex');
      const product = metadata.scope === ReferenceDocumentScope.PRODUCT;
      const cas = product ? (metadata.cas ?? null) : null;
      // La biblioteca es de toda la plataforma; los documentos de un producto, de la empresa.
      const tenantId = product ? RequestContext.tenantIdOrDefault : null;
      const category =
        metadata.category ?? (product ? ReferenceDocumentCategory.SUPPLIER_SDS : ReferenceDocumentCategory.OTHER);
      const duplicate = await this.documents.findDuplicate(hash, metadata.scope, tenantId ? { tenantId, cas } : null);
      if (duplicate && product) {
        // Ya indexado: se reutiliza, con el tipo con el que se adjunta ahora (análogo, datos del producto…).
        const reused =
          duplicate.category === category ? duplicate : await this.documents.update(duplicate.id, { category });
        return Result.success(ReferenceDocumentMapper.toResponse(reused), 'Documento ya cargado: se reutiliza');
      }
      if (duplicate) {
        return Result.failure(
          'REFERENCE_DOCUMENT_DUPLICATED',
          `Este archivo ya está cargado como "${duplicate.title}"`,
          HttpStatus.CONFLICT,
        );
      }
      const document = await this.documents.create(
        {
          title: metadata.title,
          description: metadata.description ?? null,
          category,
          scope: metadata.scope,
          cas,
          tenantId,
          language: metadata.language,
          sdsSections: metadata.sdsSections,
          fileName,
          mimeType: file.mimetype || 'application/octet-stream',
          sizeBytes: file.size,
          contentHash: hash,
          createdBy: RequestContext.userId ?? null,
        },
        file.buffer,
      );
      await this.publisher.publish(ReferenceTaskTypes.INDEX_REQUESTED, { documentId: document.id });
      return Result.accepted(ReferenceDocumentMapper.toResponse(document), 'Documento recibido: se está indexando');
    } catch (error) {
      return this.handleException('UploadReferenceDocument', error);
    }
  }
}

import { Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { AppConfig } from '@/shared/config';
import { Result } from '@/shared/util';
import { LIBRARY_DOCUMENT_CATEGORIES, PRODUCT_DOCUMENT_CATEGORIES } from '@/modules/reference/dto/request';
import { ReferenceDocumentOptionsDTO } from '@/modules/reference/dto/response';
import { DocumentTextExtractorRegistry } from '@/modules/reference/extractor';

/** Qué acepta la subida: formatos (según los extractores registrados), tamaño máximo y categorías. */
@Injectable()
export class GetReferenceDocumentOptionsService extends BaseService<void, ReferenceDocumentOptionsDTO> {
  constructor(
    private readonly extractors: DocumentTextExtractorRegistry,
    private readonly config: AppConfig,
  ) {
    super();
  }

  execute(): Promise<Result<ReferenceDocumentOptionsDTO>> {
    return Promise.resolve(
      Result.success({
        extensions: this.extractors.supportedExtensions(),
        maxSizeBytes: this.config.reference.maxUploadBytes,
        categories: [...LIBRARY_DOCUMENT_CATEGORIES],
        productCategories: [...PRODUCT_DOCUMENT_CATEGORIES],
      }),
    );
  }
}

import { Injectable } from '@nestjs/common';
import { SdsDocument } from '@prisma/client';
import { BaseService } from '@/shared/base';
import { Result } from '@/shared/util';
import { CreateSdsDocument, SdsDocumentRepository } from '@/modules/sds/sdsdocument/repository';

/** Guarda una FDS generada como BORRADOR (status DRAFT): siempre la revisa un profesional antes de publicarse. */
@Injectable()
export class CreateSdsDocumentDraftService extends BaseService<CreateSdsDocument, SdsDocument> {
  constructor(private readonly documents: SdsDocumentRepository) {
    super();
  }

  async execute(data: CreateSdsDocument): Promise<Result<SdsDocument>> {
    try {
      return Result.created(await this.documents.create(data), 'Borrador de FDS creado');
    } catch (error) {
      return this.handleException('CreateSdsDocumentDraft', error);
    }
  }
}

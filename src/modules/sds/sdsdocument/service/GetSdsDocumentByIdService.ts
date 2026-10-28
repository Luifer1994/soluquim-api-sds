import { HttpStatus, Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { RequestContext } from '@/shared/context';
import { Result } from '@/shared/util';
import { SdsFieldProposal } from '@/modules/sds/sdsdocument/mapper/SdsFieldProposal';
import { SdsDocumentRepository } from '@/modules/sds/sdsdocument/repository';
import { SdsDocumentContentDTO } from '@/modules/sds/sdsdocument/dto/response';

export interface SdsDocumentResponseDTO {
  id: string;
  status: string;
  version: number;
  language: string;
  countryCode: string | null;
  llmModel: string | null;
  promptVersion: string | null;
  createdAt: string;
  content: SdsDocumentContentDTO;
}

@Injectable()
export class GetSdsDocumentByIdService extends BaseService<{ id: string }, SdsDocumentResponseDTO> {
  constructor(private readonly documents: SdsDocumentRepository) {
    super();
  }

  async execute({ id }: { id: string }): Promise<Result<SdsDocumentResponseDTO>> {
    try {
      const document = await this.documents.findById(id, RequestContext.tenantIdOrDefault);
      if (!document) return Result.failure('SDS_DOCUMENT_NOT_FOUND', 'FDS no encontrada', HttpStatus.NOT_FOUND);
      const content = document.content as unknown as SdsDocumentContentDTO;
      return Result.success({
        id: document.id,
        status: document.status,
        version: document.version,
        language: document.language,
        countryCode: document.countryCode,
        llmModel: document.llmModel,
        promptVersion: document.promptVersion,
        createdAt: document.createdAt.toISOString(),
        content: {
          ...content,
          sections: content.sections.map((section) =>
            SdsFieldProposal.ensure(section, content.language, content.isMixture),
          ),
        },
      });
    } catch (error) {
      return this.handleException('GetSdsDocumentById', error);
    }
  }
}

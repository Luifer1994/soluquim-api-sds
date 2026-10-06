import { Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { RequestContext } from '@/shared/context';
import { Result } from '@/shared/util';
import { SdsDocumentContentDTO, SdsDocumentSummaryDTO } from '@/modules/sds/sdsdocument/dto/response';
import { SdsDocumentRepository } from '@/modules/sds/sdsdocument/repository';

/** Las FDS más recientes del tenant (resumen, sin las secciones). */
@Injectable()
export class ListSdsDocumentsService extends BaseService<{ limit: number }, SdsDocumentSummaryDTO[]> {
  constructor(private readonly documents: SdsDocumentRepository) {
    super();
  }

  async execute({ limit }: { limit: number }): Promise<Result<SdsDocumentSummaryDTO[]>> {
    try {
      const documents = await this.documents.findRecent(RequestContext.tenantIdOrDefault, limit);
      return Result.success(
        documents.map((document) => {
          const content = document.content as unknown as SdsDocumentContentDTO;
          const fields = content.sections.flatMap((s) => s.suggestion?.subsections.flatMap((sub) => sub.fields) ?? []);
          const identity = new Map(
            (content.sections[0]?.suggestion?.subsections.flatMap((sub) => sub.fields) ?? []).map((f) => [
              f.key,
              f.value,
            ]),
          );
          return {
            id: document.id,
            status: document.status,
            version: document.version,
            language: document.language,
            productName: identity.get('productName') ?? null,
            productCas: identity.get('casNumber') ?? null,
            isMixture: content.isMixture,
            components: content.components,
            filledFields: fields.filter((field) => field.value !== null).length,
            totalFields: fields.length,
            createdAt: document.createdAt.toISOString(),
            updatedAt: document.updatedAt.toISOString(),
          };
        }),
      );
    } catch (error) {
      return this.handleException('ListSdsDocuments', error);
    }
  }
}

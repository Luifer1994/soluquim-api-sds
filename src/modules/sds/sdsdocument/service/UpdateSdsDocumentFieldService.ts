import { HttpStatus, Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { RequestContext } from '@/shared/context';
import { Result } from '@/shared/util';
import { SdsDocumentFieldParamsDTO, UpdateSdsDocumentFieldDTO } from '@/modules/sds/sdsdocument/dto/request';
import { SdsCitationDTO, SdsDocumentContentDTO, SdsSectionDTO } from '@/modules/sds/sdsdocument/dto/response';
import { SdsSectionContentMapper } from '@/modules/sds/sdsdocument/mapper';
import { SdsFieldProposal } from '@/modules/sds/sdsdocument/mapper/SdsFieldProposal';
import { SdsDocumentRepository } from '@/modules/sds/sdsdocument/repository';

export type UpdateSdsDocumentFieldInput = SdsDocumentFieldParamsDTO & UpdateSdsDocumentFieldDTO;

/**
 * El revisor cambia UN campo de una sección: escribe su propio texto (`user`) o toma el dato de una de
 * las fuentes de esa sección (`source`, que queda como cita). La plantilla es cerrada: solo se editan
 * campos que existen. Devuelve la sección ya recalculada (texto, faltantes, pictogramas).
 */
@Injectable()
export class UpdateSdsDocumentFieldService extends BaseService<UpdateSdsDocumentFieldInput, SdsSectionDTO> {
  constructor(private readonly documents: SdsDocumentRepository) {
    super();
  }

  async execute(input: UpdateSdsDocumentFieldInput): Promise<Result<SdsSectionDTO>> {
    try {
      const tenantId = RequestContext.tenantIdOrDefault;
      const document = await this.documents.findById(input.id, tenantId);
      if (!document) return Result.failure('SDS_DOCUMENT_NOT_FOUND', 'FDS no encontrada', HttpStatus.NOT_FOUND);
      if (document.status !== 'DRAFT' && document.status !== 'IN_REVIEW') {
        return Result.failure('SDS_DOCUMENT_NOT_EDITABLE', 'La FDS ya no se puede editar', HttpStatus.CONFLICT);
      }

      const content = document.content as unknown as SdsDocumentContentDTO;
      const section = content.sections.find((s) => s.number === input.number);
      if (!section?.suggestion) {
        return Result.failure(
          'SDS_SECTION_NOT_FOUND',
          'La sección no tiene contenido para editar',
          HttpStatus.NOT_FOUND,
        );
      }

      const prepared = SdsFieldProposal.ensure(section, content.language, content.isMixture);
      if (input.restoreProposed) {
        const proposed = prepared.suggestion?.subsections
          .flatMap((sub) => sub.fields)
          .find((field) => field.key === input.key)?.proposed;
        if (!proposed) {
          return Result.failure(
            'SDS_SUGGESTION_NOT_FOUND',
            'No hay una sugerencia guardada para este campo',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        input = { ...input, value: proposed.value, source: undefined };
      }
      if (input.value === undefined) {
        return Result.failure('SDS_FIELD_VALUE_REQUIRED', 'Indica el valor del campo', HttpStatus.BAD_REQUEST);
      }

      let citations: SdsCitationDTO[] = [];
      if (input.value && input.source) {
        const evidence = section.bySource.find((e) => e.source === input.source?.source && e.cas === input.source.cas);
        if (!evidence) {
          return Result.failure(
            'SDS_SOURCE_NOT_IN_SECTION',
            'Esa fuente no aporta datos a esta sección',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        citations = [
          {
            ref: `${evidence.source}:${evidence.cas}`,
            source: evidence.source,
            cas: evidence.cas,
            title: [evidence.source, evidence.componentName ?? evidence.cas].join(' · '),
            sourceUrl: evidence.sourceUrl ?? null,
          },
        ];
      }

      const suggestion = SdsSectionContentMapper.applyChange(
        prepared.suggestion!,
        input.key,
        {
          value: input.value,
          origin: input.value ? (citations.length ? 'source' : 'user') : null,
          citations,
          editedAt: new Date().toISOString(),
          editedBy: RequestContext.userId ?? null,
        },
        content.language,
      );
      if (!suggestion) {
        return Result.failure('SDS_FIELD_NOT_FOUND', 'Ese campo no existe en la sección', HttpStatus.NOT_FOUND);
      }

      const updated: SdsSectionDTO = { ...section, suggestion };
      const saved = await this.documents.updateContent(document.id, tenantId, document.updatedAt, {
        ...content,
        sections: content.sections.map((s) => (s.number === input.number ? updated : s)),
      });
      if (!saved) {
        return Result.failure(
          'SDS_DOCUMENT_CHANGED',
          'La FDS cambió mientras la editabas. Vuelve a intentarlo.',
          HttpStatus.CONFLICT,
        );
      }
      return Result.success(updated, 'Campo actualizado');
    } catch (error) {
      return this.handleException('UpdateSdsDocumentField', error);
    }
  }
}

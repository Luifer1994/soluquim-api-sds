import { SdsLabelProposal } from '@/modules/sds/sdsdocument/mapper/SdsLabelProposal';
import { SdsSectionContentMapper } from '@/modules/sds/sdsdocument/mapper/SdsSectionContentMapper';
import { SdsSectionDTO } from '@/modules/sds/sdsdocument/dto/response';
import { SourceFallbackFiller } from '@/modules/sds/sdsgeneration/assembler/SourceFallbackFiller';

/**
 * Completa `proposed` en cada campo de la sección: primero la sugerencia que ya trae el campo
 * (IA, solicitud o sistema) y, si el revisor ya la pisó y no quedó copia, el dato de las fuentes
 * de esa sección que corresponde al campo.
 */
export class SdsFieldProposal {
  static ensure(section: SdsSectionDTO, language: string, isMixture: boolean): SdsSectionDTO {
    if (!section.suggestion) return section;
    const subsections = section.suggestion.subsections.map((sub) => ({
      ...sub,
      fields: sub.fields.map((field) => {
        if (field.proposed) return field;
        const proposed =
          SdsSectionContentMapper.proposalOf(field) ??
          SourceFallbackFiller.proposeFromEvidence(section.number, field.key, section.bySource, language, isMixture) ??
          SdsLabelProposal.fromEvidence(field.key, section.bySource, language);
        return proposed ? { ...field, proposed } : field;
      }),
    }));
    return { ...section, suggestion: { ...section.suggestion, subsections } };
  }
}

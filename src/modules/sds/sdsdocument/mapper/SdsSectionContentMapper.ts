import { GhsPictogramCatalog, GhsStatementCatalog } from '@/modules/knowledge';
import {
  SdsCitationDTO,
  SdsFieldDTO,
  SdsFieldProposalDTO,
  SdsSectionSuggestionDTO,
  SdsSubsectionDTO,
} from '@/modules/sds/sdsdocument/dto/response';

export const NO_DATA = 'Sin datos disponibles';

export interface SdsFieldChange {
  value: string | null;
  origin: SdsFieldDTO['origin'];
  citations: SdsCitationDTO[];
  editedAt?: string;
  editedBy?: string | null;
}

/**
 * Lo DERIVADO de los campos de una sección (funciones puras): el texto, los campos vacíos y los
 * pictogramas. Lo usan la generación y la edición, para que una sección quede igual venga de donde venga.
 */
export class SdsSectionContentMapper {
  /** La sección como texto: apartados y campos de la plantilla; los vacíos, "Sin datos disponibles". */
  static render(subsections: SdsSubsectionDTO[]): string {
    return subsections
      .map((sub) => {
        const lines = sub.fields.map((field) => {
          const value = field.value ?? NO_DATA;
          // Un apartado de un solo campo no repite la etiqueta (p. ej. "10.1 Reactividad").
          return sub.fields.length === 1 ? value : `${field.label}: ${value}`;
        });
        return `${sub.code} ${sub.title}\n${lines.join('\n')}`;
      })
      .join('\n\n');
  }

  static missing(subsections: SdsSubsectionDTO[]): string[] {
    return subsections.flatMap((sub) => sub.fields.filter((field) => field.value === null).map((field) => field.label));
  }

  /**
   * Normaliza el valor según el tipo del campo y agrega su forma estructurada:
   *  - pictogramas: los códigos GHS válidos → `pictograms`,
   *  - frases H/P: una por línea con su texto oficial → `statements`,
   *  - palabra de advertencia: en el idioma de la ficha.
   */
  static withDerived(field: SdsFieldDTO, language: string): SdsFieldDTO {
    if (field.kind === 'pictograms') {
      const pictograms = GhsPictogramCatalog.fromText(field.value);
      return SdsSectionContentMapper.seal({
        ...field,
        value: pictograms.map((p) => p.code).join(', ') || field.value,
        pictograms,
      });
    }
    if (field.kind === 'statements') {
      const statements = GhsStatementCatalog.parse(field.value, language);
      return SdsSectionContentMapper.seal({
        ...field,
        value: statements.length ? GhsStatementCatalog.render(statements) : field.value,
        statements,
      });
    }
    if (field.kind === 'signalWord' && field.value) {
      return SdsSectionContentMapper.seal({ ...field, value: GhsStatementCatalog.signalWord(field.value, language) });
    }
    return SdsSectionContentMapper.seal(field);
  }

  /** La sugerencia vigente del campo, si el valor actual todavía es el propuesto (no texto del revisor). */
  static proposalOf(field: SdsFieldDTO): SdsFieldProposalDTO | undefined {
    if (field.proposed) return field.proposed;
    if (!field.value || !field.origin || field.origin === 'user') return undefined;
    return { value: field.value, origin: field.origin, citations: field.citations };
  }

  /** Deja escrita la sugerencia la primera vez que el campo tiene un valor que no escribió el revisor. */
  static seal(field: SdsFieldDTO): SdsFieldDTO {
    const proposed = SdsSectionContentMapper.proposalOf(field);
    return proposed ? { ...field, proposed } : field;
  }

  /**
   * Cambia UN campo de la sección y recalcula lo derivado. Devuelve null si la sección no tiene ese
   * campo: la plantilla es cerrada, no se agregan campos.
   */
  static applyChange(
    suggestion: SdsSectionSuggestionDTO,
    key: string,
    change: SdsFieldChange,
    language: string,
  ): SdsSectionSuggestionDTO | null {
    if (!suggestion.subsections.some((sub) => sub.fields.some((field) => field.key === key))) return null;
    const subsections = suggestion.subsections.map((sub) => ({
      ...sub,
      fields: sub.fields.map((field) => {
        if (field.key !== key) return field;
        const proposed = SdsSectionContentMapper.proposalOf(field);
        const restoring = proposed != null && (change.value?.trim() || null) === proposed.value.trim();
        const next: SdsFieldDTO = restoring
          ? {
              ...field,
              proposed,
              value: proposed.value,
              origin: proposed.origin,
              citations: proposed.citations,
              editedAt: undefined,
              editedBy: undefined,
            }
          : { ...field, proposed, ...change };
        return SdsSectionContentMapper.withDerived(next, language);
      }),
    }));
    return {
      ...suggestion,
      subsections,
      content: SdsSectionContentMapper.render(subsections),
      missingData: SdsSectionContentMapper.missing(subsections),
    };
  }
}

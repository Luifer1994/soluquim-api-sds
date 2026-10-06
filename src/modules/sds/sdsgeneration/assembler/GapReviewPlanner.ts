import { SdsSectionDefinition } from '@/modules/knowledge';
import { SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument/dto/response';
import { SdsSectionContentMapper } from '@/modules/sds/sdsdocument/mapper';

/**
 * Segunda pasada del agente, solo sobre lo que quedó vacío (funciones puras): arma la plantilla
 * reducida a los campos sin dato y luego aplica lo que la revisión encontró, sin tocar lo ya llenado.
 */
export class GapReviewPlanner {
  /** La plantilla de cada sección reducida a sus campos vacíos; las secciones completas no entran. */
  static pending(
    templates: readonly SdsSectionDefinition[],
    suggestions: ReadonlyMap<number, SdsSectionSuggestionDTO>,
  ): SdsSectionDefinition[] {
    return templates.flatMap((template) => {
      const suggestion = suggestions.get(template.number);
      const filled = new Set(
        suggestion?.subsections.flatMap((sub) => sub.fields.filter((f) => f.value !== null).map((f) => f.key)) ?? [],
      );
      const subsections = template.subsections
        .map((sub) => ({ ...sub, fields: sub.fields.filter((field) => !filled.has(field.key)) }))
        .filter((sub) => sub.fields.length);
      return subsections.length ? [{ ...template, subsections }] : [];
    });
  }

  /** Pone en la sección los campos que la revisión sí llenó (con sus citas). Lo ya llenado no se toca. */
  static apply(
    suggestion: SdsSectionSuggestionDTO,
    reviewed: SdsSectionSuggestionDTO,
    language: string,
  ): SdsSectionSuggestionDTO {
    const found = reviewed.subsections.flatMap((sub) => sub.fields.filter((field) => field.value !== null));
    const current = new Map(suggestion.subsections.flatMap((sub) => sub.fields.map((f) => [f.key, f.value] as const)));
    const merged = found
      .filter((field) => current.get(field.key) === null)
      .reduce(
        (result, field) =>
          SdsSectionContentMapper.applyChange(
            result,
            field.key,
            { value: field.value, origin: 'agent', citations: field.citations },
            language,
          ) ?? result,
        suggestion,
      );
    return {
      ...merged,
      invalidRefs: [...new Set([...merged.invalidRefs, ...reviewed.invalidRefs])],
      // Un valor descartado en la 1.ª pasada deja de ser aviso si la revisión llenó ese campo con cita.
      discarded: [
        ...merged.discarded.filter((d) => !found.some((field) => field.key === d.key)),
        ...reviewed.discarded.filter((d) => current.get(d.key) === null),
      ],
    };
  }
}

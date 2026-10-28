import { escapeRegExp, foldText } from '@/shared/util';
import { SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument/dto/response';
import { SdsSectionContentMapper } from '@/modules/sds/sdsdocument/mapper';
import { MixtureComponentInput } from '@/modules/sds/sdsgeneration/assembler/MixtureConcentrationProfile';

/** Desde este % un componente es el mayoritario de la mezcla (sus propiedades la representan). */
const MAJOR_COMPONENT_PERCENTAGE = 50;

/**
 * Propiedades físicas y químicas de una MEZCLA (sección 9, función pura): los valores de un componente
 * minoritario no describen la mezcla (el punto de fusión de la fenolftaleína al 1 % no es el de una
 * solución etanólica). Quita las líneas atribuidas a componentes por debajo del 50 % cuando hay uno
 * mayoritario, y las deja en `discarded` para que el revisor las vea. Sin componente mayoritario no
 * filtra: decide el revisor.
 */
export class MixturePropertyFilter {
  static apply(
    suggestion: SdsSectionSuggestionDTO,
    components: readonly MixtureComponentInput[],
    language: string,
  ): SdsSectionSuggestionDTO {
    if (components.length < 2 || !components.some((c) => c.percentage >= MAJOR_COMPONENT_PERCENTAGE)) {
      return suggestion;
    }
    const minorPatterns = components
      .filter((c) => c.percentage < MAJOR_COMPONENT_PERCENTAGE)
      .flatMap((c) => [c.name, c.cas].filter((value): value is string => Boolean(value)))
      .map((label) => new RegExp(`(^|[\\s(\\[])${escapeRegExp(foldText(label))}(\\s*[:)\\]]|$)`));
    if (!minorPatterns.length) return suggestion;

    const discarded = [...suggestion.discarded];
    const subsections = suggestion.subsections.map((sub) => ({
      ...sub,
      fields: sub.fields.map((field) => {
        if (!field.value) return field;
        const lines = field.value.split('\n');
        const kept = lines.filter((line) => !minorPatterns.some((pattern) => pattern.test(foldText(line))));
        if (kept.length === lines.length) return field;
        discarded.push({
          key: field.key,
          label: field.label,
          value: lines.filter((line) => !kept.includes(line)).join('\n'),
        });
        const value = kept.join('\n').trim() || null;
        return SdsSectionContentMapper.withDerived(
          { ...field, value, origin: value ? field.origin : null, citations: value ? field.citations : [] },
          language,
        );
      }),
    }));
    return {
      ...suggestion,
      subsections,
      discarded,
      content: SdsSectionContentMapper.render(subsections),
      missingData: SdsSectionContentMapper.missing(subsections),
    };
  }
}

import { SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument/dto/response';
import { SdsDraftDigest, SdsQualityIssue } from '@/modules/sds/sdsgeneration/agent/review';

const SEVERITY_LABELS: Record<SdsQualityIssue['severity'], string> = { high: 'alta', medium: 'media', low: 'baja' };

/**
 * Los problemas de la revisión de calidad quedan como CONFLICTOS de su sección (los ve el revisor, que decide); la
 * ficha no cambia. Un problema de una sección sin sugerencia se descarta. Función pura: devuelve las secciones
 * nuevas, sin tocar las recibidas.
 */
export class QualityIssueApplier {
  static apply(
    suggestions: ReadonlyMap<number, SdsSectionSuggestionDTO>,
    issues: readonly SdsQualityIssue[],
  ): Map<number, SdsSectionSuggestionDTO> {
    const result = new Map(suggestions);
    for (const issue of issues) {
      const section = result.get(issue.section);
      if (!section) continue;
      const related = issue.relatedSections.filter((number) => number !== issue.section);
      result.set(issue.section, {
        ...section,
        conflicts: [
          ...section.conflicts,
          {
            field: issue.field,
            chosen: SdsDraftDigest.valueOf(suggestions, issue.section, issue.field) ?? '',
            alternatives: issue.suggestion ? [issue.suggestion] : [],
            reason:
              `Revisión de coherencia (prioridad ${SEVERITY_LABELS[issue.severity]}): ${issue.problem}` +
              (related.length ? ` (ver secciones ${related.join(', ')})` : ''),
          },
        ],
      });
    }
    return result;
  }
}

import { SdsSectionCatalog } from '@/modules/knowledge';
import { SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument/dto/response';

export type SdsDraftSuggestions = ReadonlyMap<number, SdsSectionSuggestionDTO>;

/** Largo máximo de un valor en el resumen: lo justo para revisar coherencia, sin repetir textos largos. */
const MAX_VALUE_CHARS = 500;

/**
 * La ficha redactada en texto compacto ("## 9. Propiedades…\n- Punto de inflamación: -20 °C"), para que un agente
 * revise coherencia leyendo poco. Solo los campos con valor; los textos largos se recortan.
 */
export class SdsDraftDigest {
  static render(suggestions: SdsDraftSuggestions, sections: readonly number[]): string {
    const titles = new Map(SdsSectionCatalog.all().map((section) => [section.number, section.title]));
    return [...new Set(sections)]
      .sort((a, b) => a - b)
      .flatMap((number) => {
        const lines = (suggestions.get(number)?.subsections ?? [])
          .flatMap((subsection) => subsection.fields)
          .filter((field) => field.value?.trim())
          .map((field) => `- ${field.label}: ${SdsDraftDigest.clip(field.value ?? '')}`);
        return lines.length ? [`## ${number}. ${titles.get(number) ?? ''}`, ...lines, ''] : [];
      })
      .join('\n')
      .trim();
  }

  /** Valor actual de un campo de una sección (por su etiqueta), o null si no está o está vacío. */
  static valueOf(suggestions: SdsDraftSuggestions, section: number, label: string): string | null {
    const wanted = label.trim().toLowerCase();
    const field = (suggestions.get(section)?.subsections ?? [])
      .flatMap((subsection) => subsection.fields)
      .find((candidate) => candidate.label.trim().toLowerCase() === wanted);
    return field?.value?.trim() || null;
  }

  private static clip(value: string): string {
    const flat = value.replace(/\s+/g, ' ').trim();
    return flat.length > MAX_VALUE_CHARS ? `${flat.slice(0, MAX_VALUE_CHARS)}…` : flat;
  }
}

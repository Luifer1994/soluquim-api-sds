import { CurrentSourceData } from '@/modules/substance';
import { SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument/dto/response';

export interface ProductReferenceQuery {
  /** "MEZCLA: Etanol (CAS 64-17-5) 70 %, Agua (CAS 7732-18-5) 30 %". */
  product: string;
  /** CAS de los componentes y números ONU que traen sus fuentes ("UN1170" y "UN 1170"). */
  identifiers: string[];
  /** Códigos H de los componentes (afinan la búsqueda semántica: P asociados, guías por peligro). */
  terms: string[];
}

interface QueryComponent {
  cas: string;
  name: string | null;
  percentage: number;
  concentration?: string;
}

const UN_NUMBER = /\bUN\s?(\d{4})\b/g;
const H_CODE = /\b(?:EU)?H\d{3}\b/g;
/** Tope del resumen de la etapa 1 que recibe la etapa 2 (caracteres). */
const PRIOR_SECTIONS_MAX_CHARS = 12000;

/**
 * Lo que identifica al producto para buscar en la documentación de referencia (función pura). El número
 * ONU y los códigos H salen de lo que trajeron las fuentes de cada componente: así la GRE y la Lista de
 * Mercancías Peligrosas se encuentran por su número, sin que el agente tenga que adivinarlo.
 */
export class ProductReferenceQueryBuilder {
  static build(components: readonly QueryComponent[], current: readonly CurrentSourceData[]): ProductReferenceQuery {
    const kind = components.length > 1 ? 'MEZCLA' : 'SUSTANCIA';
    const product = `${kind}: ${components
      .map(
        (c) =>
          `${c.name ?? 'Sin nombre'} (CAS ${c.cas})${components.length > 1 ? ` ${c.concentration ?? `${c.percentage} %`}` : ''}`,
      )
      .join(', ')}`;
    const text = JSON.stringify(current.map((component) => component.sources));
    const unNumbers = [...new Set([...text.matchAll(UN_NUMBER)].map((match) => match[1]))];
    const hCodes = [...new Set(text.match(H_CODE) ?? [])].sort();
    return {
      product,
      identifiers: [...components.map((c) => c.cas), ...unNumbers.flatMap((number) => [`UN${number}`, `UN ${number}`])],
      terms: hCodes,
    };
  }

  /**
   * Las secciones ya redactadas (etapa 1), resumidas para dárselas como contexto a la etapa 2: clasificación,
   * propiedades y toxicología de esta misma ficha. Recortado a un tope de caracteres.
   */
  static priorSections(
    suggestions: ReadonlyMap<number, SdsSectionSuggestionDTO>,
    titles: ReadonlyMap<number, string>,
  ): string | undefined {
    const text = [...suggestions]
      .sort(([a], [b]) => a - b)
      .filter(([, suggestion]) => suggestion.content?.trim())
      .map(([number, suggestion]) => `— Sección ${number}: ${titles.get(number) ?? ''} —\n${suggestion.content.trim()}`)
      .join('\n\n');
    if (!text) return undefined;
    return text.length > PRIOR_SECTIONS_MAX_CHARS ? `${text.slice(0, PRIOR_SECTIONS_MAX_CHARS)}\n(…)` : text;
  }
}

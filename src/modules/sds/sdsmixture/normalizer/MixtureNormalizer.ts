import { MixtureConcentration } from '@/modules/sds/sdsmixture/concentration';
import { MixtureComponentDTO } from '@/modules/sds/sdsmixture/dto/request';

export interface NormalizedMixture {
  components: MixtureComponentDTO[];
  totalPercentage: number;
  /** CAS que venían repetidos y se fusionaron sumando sus porcentajes. */
  mergedDuplicates: string[];
}

const round = (value: number): number => Math.round(value * 10_000) / 10_000;
/** El símbolo se conserva al fusionar solo si todas las entradas del CAS lo comparten. */
const shared = <T>(values: T[]): T | undefined =>
  values.every((value) => value === values[0]) ? values[0] : undefined;

/** Varias entradas del mismo CAS → una: suma de los valores (y de los máximos, si alguna es un rango). */
function merge(entries: MixtureComponentDTO[]): MixtureComponentDTO {
  if (entries.length === 1) return { ...entries[0], percentage: round(entries[0].percentage) };
  const isRange = entries.some((entry) => entry.percentageMax !== undefined);
  const symbol = shared(entries.map((entry) => entry.symbol));
  const symbolMax = isRange ? shared(entries.map((entry) => entry.symbolMax)) : undefined;
  return {
    cas: entries[0].cas,
    percentage: round(entries.reduce((sum, entry) => sum + entry.percentage, 0)),
    ...(symbol ? { symbol } : {}),
    ...(isRange
      ? { percentageMax: round(entries.reduce((sum, entry) => sum + (entry.percentageMax ?? entry.percentage), 0)) }
      : {}),
    ...(symbolMax ? { symbolMax } : {}),
  };
}

/**
 * Normaliza una mezcla (función pura, no muta la entrada):
 *  - CAS repetidos → un solo componente con la suma de los porcentajes (y de los máximos de un rango),
 *  - porcentajes redondeados a 4 decimales,
 *  - orden por concentración máxima descendente (el componente mayoritario primero), y CAS como desempate.
 * El mismo orden y redondeo sirven después para la clave de cache de la FDS de la mezcla.
 */
export class MixtureNormalizer {
  static normalize(components: readonly MixtureComponentDTO[]): NormalizedMixture {
    const byCas = new Map<string, MixtureComponentDTO[]>();
    for (const component of components) byCas.set(component.cas, [...(byCas.get(component.cas) ?? []), component]);

    const mergedDuplicates = [...byCas].filter(([, entries]) => entries.length > 1).map(([cas]) => cas);
    const normalized = [...byCas.values()]
      .map(merge)
      .sort((a, b) => MixtureConcentration.upper(b) - MixtureConcentration.upper(a) || a.cas.localeCompare(b.cas));

    return {
      components: normalized,
      totalPercentage: round(normalized.reduce((sum, component) => sum + component.percentage, 0)),
      mergedDuplicates,
    };
  }
}

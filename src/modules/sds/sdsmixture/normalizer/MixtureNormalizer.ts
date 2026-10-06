import { MixtureComponentDTO } from '@/modules/sds/sdsmixture/dto/request';

export interface NormalizedMixture {
  components: MixtureComponentDTO[];
  totalPercentage: number;
  /** CAS que venían repetidos y se fusionaron sumando sus porcentajes. */
  mergedDuplicates: string[];
}

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * Normaliza una mezcla (función pura, no muta la entrada):
 *  - CAS repetidos → un solo componente con la suma de los porcentajes,
 *  - porcentajes redondeados a 4 decimales,
 *  - orden por porcentaje descendente (el componente mayoritario primero), y CAS como desempate.
 * El mismo orden y redondeo sirven después para la clave de cache de la FDS de la mezcla.
 */
export class MixtureNormalizer {
  static normalize(components: readonly MixtureComponentDTO[]): NormalizedMixture {
    const byCas = new Map<string, number>();
    const mergedDuplicates: string[] = [];

    for (const { cas, percentage } of components) {
      if (byCas.has(cas) && !mergedDuplicates.includes(cas)) mergedDuplicates.push(cas);
      byCas.set(cas, (byCas.get(cas) ?? 0) + percentage);
    }

    const normalized = [...byCas.entries()]
      .map(([cas, percentage]) => ({ cas, percentage: round(percentage) }))
      .sort((a, b) => b.percentage - a.percentage || a.cas.localeCompare(b.cas));

    return {
      components: normalized,
      totalPercentage: round(normalized.reduce((sum, component) => sum + component.percentage, 0)),
      mergedDuplicates,
    };
  }
}

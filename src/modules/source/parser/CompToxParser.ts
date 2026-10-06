import { SourceRecord } from '@/modules/source/dto';

export interface CompToxSearchResponseItem {
  dtxsid: string;
  casrn?: string;
  preferredName?: string;
  molFormula?: string;
  averageMass?: number;
  iupacName?: string;
  qcLevelDesc?: string;
}

interface CompToxStats {
  count?: number;
  mean?: number;
  median?: number;
  min?: number;
  max?: number;
}

export interface CompToxPropertiesResponse {
  data?: Array<{ name: string; unit?: string; predicted?: CompToxStats | null; experimental?: CompToxStats | null }>;
}

export interface CompToxToxvalRow {
  source?: string;
  toxvalType?: string;
  toxvalNumericQualifier?: string;
  toxvalNumeric?: number;
  toxvalUnits?: string;
  exposureRoute?: string;
  speciesCommon?: string;
  year?: string;
  studyDurationValue?: number;
  studyDurationUnits?: string;
}

export interface CompToxHazardResponse {
  _embedded?: { Hazard?: Array<{ human?: Array<{ name: string; rawData?: CompToxToxvalRow[] }> | null }> };
}

export const COMPTOX_DASHBOARD_URL = 'https://comptox.epa.gov/dashboard/chemical/details/';

/** Propiedad del dashboard → campo normalizado. El resto sale como `physical.other.*`. */
const PROPERTY_FIELDS: Record<string, string> = {
  'Boiling Point': 'physical.boilingPoint',
  'Melting Point': 'physical.meltingPoint',
  'Flash Point': 'physical.flashPoint',
  'Vapor Pressure': 'physical.vaporPressure',
  'Water Solubility': 'physical.waterSolubility',
  'LogKow: Octanol-Water': 'physical.logPow',
  Density: 'physical.density',
  Viscosity: 'physical.viscosity',
  "Henry's Law": 'physical.henrysLaw',
  'Surface Tension': 'physical.surfaceTension',
};

/** Valores de toxicidad aguda que necesita la FDS (sección 11) y la fórmula ETA de la mezcla. */
const ACUTE_TYPES = new Set(['LD50', 'LC50']);

const round = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : Math.round(value * 10_000) / 10_000;

/** Parser PURO de la API del CompTox Chemicals Dashboard (EPA). */
export class CompToxParser {
  static detailsUrl(dtxsid: string): string {
    return `${COMPTOX_DASHBOARD_URL}${dtxsid}`;
  }

  static pickByCas(items: CompToxSearchResponseItem[], cas: string): CompToxSearchResponseItem | undefined {
    return items.find((item) => item.casrn === cas);
  }

  /**
   * Cada propiedad trae estadísticas de valores EXPERIMENTALES y PREDICHOS (modelos QSAR). Se devuelven
   * por separado: para la FDS manda el experimental; el predicho solo sirve si no hay otro dato.
   */
  static parseProperties(response: CompToxPropertiesResponse, sourceUrl: string): SourceRecord[] {
    const summarize = (stats: CompToxStats | null | undefined) =>
      stats?.count
        ? { median: round(stats.median), min: round(stats.min), max: round(stats.max), count: stats.count }
        : undefined;

    return (response.data ?? []).flatMap((property) => {
      const experimental = summarize(property.experimental);
      const predicted = summarize(property.predicted);
      if (!experimental && !predicted) return [];
      const slug = property.name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) =>
        c ? c.toUpperCase() : '',
      );
      return [
        {
          field: PROPERTY_FIELDS[property.name] ?? `physical.other.${slug.charAt(0).toLowerCase()}${slug.slice(1)}`,
          label: property.name,
          value: { experimental, predicted },
          unit: property.unit,
          sourceUrl,
        },
      ];
    });
  }

  /**
   * DL50 / CL50 de ToxValDB agrupados por vía y especie, con cada valor y su fuente. Una sustancia
   * puede tener decenas de estudios: se informa el MÍNIMO (el más conservador) y la lista ordenada.
   */
  static parseAcuteToxicity(response: CompToxHazardResponse, sourceUrl: string): SourceRecord[] {
    const groups = response._embedded?.Hazard?.[0]?.human ?? [];
    const rows = groups
      .flatMap((group) => group.rawData ?? [])
      .filter(
        (row) =>
          ACUTE_TYPES.has(row.toxvalType ?? '') && typeof row.toxvalNumeric === 'number' && row.toxvalNumeric > 0,
      );

    const byKey = new Map<string, CompToxToxvalRow[]>();
    for (const row of rows) {
      const key = `${row.toxvalType}|${(row.exposureRoute ?? 'unknown').toLowerCase()}|${row.speciesCommon ?? 'unknown'}|${row.toxvalUnits ?? ''}`;
      byKey.set(key, [...(byKey.get(key) ?? []), row]);
    }

    const summary = [...byKey.entries()]
      .map(([key, values]) => {
        const [type, route, species, unit] = key.split('|');
        const sorted = [...values].sort((a, b) => a.toxvalNumeric! - b.toxvalNumeric!);
        return {
          type,
          route,
          species,
          unit,
          lowest: sorted[0].toxvalNumeric,
          count: sorted.length,
          values: sorted.slice(0, 10).map((v) => ({
            value: v.toxvalNumeric,
            qualifier: v.toxvalNumericQualifier,
            source: v.source,
            year: v.year,
          })),
        };
      })
      .sort(
        (a, b) => a.type.localeCompare(b.type) || a.route.localeCompare(b.route) || a.species.localeCompare(b.species),
      );

    return summary.length
      ? [{ field: 'toxicology.acute', label: 'Acute toxicity (ToxValDB LD50/LC50)', value: summary, sourceUrl }]
      : [];
  }
}

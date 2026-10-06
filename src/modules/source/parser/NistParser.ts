import * as cheerio from 'cheerio';
import { SourceRecord } from '@/modules/source/dto';

export const NIST_BASE_URL = 'https://webbook.nist.gov/cgi/cbook.cgi';
export const NIST_ATTRIBUTION = 'NIST Chemistry WebBook, NIST Standard Reference Database 69';

/** Magnitud de la tabla "One dimensional data" → campo. Las que no están salen como `thermo.<slug>`. */
const QUANTITY_FIELDS: Record<string, string> = {
  Tboil: 'physical.boilingPoint',
  Tfus: 'physical.meltingPoint',
  Ttriple: 'thermo.tripleTemperature',
  Tc: 'thermo.criticalTemperature',
  Pc: 'thermo.criticalPressure',
  Vc: 'thermo.criticalVolume',
  ρc: 'thermo.criticalDensity',
  'ΔvapH°': 'thermo.enthalpyOfVaporization',
  'ΔfH°gas': 'thermo.enthalpyOfFormationGas',
  'ΔfH°liquid': 'thermo.enthalpyOfFormationLiquid',
  'ΔcH°gas': 'thermo.enthalpyOfCombustionGas',
  'ΔcH°liquid': 'thermo.enthalpyOfCombustionLiquid',
  'S°gas': 'thermo.entropyGas',
  'S°liquid': 'thermo.entropyLiquid',
};

export interface NistValue {
  value: number;
  uncertainty?: number;
  unit: string;
  /** Solo para temperaturas en K: conversión exacta a °C (K − 273,15). */
  celsius?: number;
  /** AVG = promedio evaluado por NIST; si no, el método del estudio. */
  method?: string;
  reference?: string;
  comment?: string;
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** "351.5 ± 0.2" → { value: 351.5, uncertainty: 0.2 }. Acepta puntos finales ("159."). */
function parseValue(text: string): { value: number; uncertainty?: number } | undefined {
  const [main, uncertainty] = text.split('±').map((part) => parseFloat(part.replace(/[^\d.eE+-]/g, '')));
  if (!Number.isFinite(main)) return undefined;
  return Number.isFinite(uncertainty) ? { value: main, uncertainty } : { value: main };
}

/**
 * Parser PURO del NIST Chemistry WebBook (página con `Mask=7`: termoquímica de gas y condensada +
 * cambios de fase, en una sola petición). Datos con referencia bibliográfica por valor.
 */
export class NistParser {
  static pageUrl(cas: string): string {
    return `${NIST_BASE_URL}?ID=C${cas.replace(/-/g, '')}&Units=SI&Mask=7`;
  }

  static isNotFound(html: string): boolean {
    return /Registry Number Not Found|Name Not Found/i.test(cheerio.load(html)('main h1').first().text());
  }

  static parse(html: string, sourceUrl: string): SourceRecord[] {
    const $ = cheerio.load(html);
    const records: SourceRecord[] = [];
    const add = (field: string, label: string, value: unknown, unit?: string) => {
      if (value !== undefined && value !== '') records.push({ field, label, value, unit, sourceUrl });
    };

    add('identity.name', 'Name', clean($('main h1').first().text()));
    $('main ul li').each((_, li) => {
      const label = clean($(li).children('strong').first().text()).replace(/:$/, '');
      const text = clean(
        $(li).find('span.inchi-text').first().text() || $(li).clone().children('strong').remove().end().text(),
      );
      if (label === 'Formula') add('identity.molecularFormula', label, text);
      if (label === 'Molecular weight') add('identity.molecularWeight', label, parseFloat(text), 'g/mol');
      if (label === 'IUPAC Standard InChIKey') add('identity.inchiKey', label, text);
      if (label === 'CAS Registry Number') add('identity.cas', label, text);
    });

    // Por magnitud: el promedio evaluado (fila .cal) si existe; si no, el primer valor experimental.
    const byQuantity = new Map<string, NistValue>();
    $('table.data[aria-label="One dimensional data"] tr').each((_, row) => {
      const cells = $(row).children('td');
      if (cells.length < 3) return;
      const quantity = clean(cells.eq(0).text());
      const parsed = parseValue(clean(cells.eq(1).text()));
      const unit = clean(cells.eq(2).text());
      if (!quantity || !parsed) return;

      const isEvaluated = $(row).hasClass('cal');
      const existing = byQuantity.get(quantity);
      if (existing && (existing.method === 'AVG' || !isEvaluated)) return;

      byQuantity.set(quantity, {
        ...parsed,
        unit,
        celsius: unit === 'K' ? Math.round((parsed.value - 273.15) * 100) / 100 : undefined,
        method: clean(cells.eq(3).text()) || undefined,
        reference: clean(cells.eq(4).text()) || undefined,
        comment: clean(cells.eq(5).text()) || undefined,
      });
    });

    for (const [quantity, value] of byQuantity) {
      const slug = quantity.replace(/[^A-Za-z0-9]+/g, '');
      add(
        QUANTITY_FIELDS[quantity] ?? `thermo.${slug.charAt(0).toLowerCase()}${slug.slice(1)}`,
        quantity,
        value,
        value.unit,
      );
    }
    add('meta.attribution', 'Attribution', NIST_ATTRIBUTION);
    return records;
  }
}

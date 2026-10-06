import * as cheerio from 'cheerio';
import { SourceRecord } from '@/modules/source/dto';

export const OSHA_BASE_URL = 'https://www.osha.gov';

const clean = (text: string): string =>
  text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Agencias de la tabla de límites → id de su columna (atributo `headers`). */
const AGENCIES = {
  oshaPel: 'OshPel',
  nioshRel: 'NioshRel',
  acgihTlv: 'AcgihTlv',
  calOshaPel: 'CalOshPel',
} as const;

/** Sufijo de cada valor dentro de la columna de la agencia. */
const LIMIT_FIELDS: Record<keyof typeof AGENCIES, Record<'twa' | 'stel' | 'ceiling' | 'skin', string>> = {
  oshaPel: { twa: 'PelTwa', stel: 'PelStel', ceiling: 'PelC', skin: 'PelCSkin' },
  nioshRel: { twa: 'RelTwa', stel: 'RelStel', ceiling: 'RelC', skin: 'RelCSkin' },
  acgihTlv: { twa: 'TlvTwa', stel: 'TlvStel', ceiling: 'TlvC', skin: 'TlvCSkin' },
  calOshaPel: { twa: 'CalPelTwa', stel: 'CalPelStel', ceiling: 'CalPelC', skin: 'CalPelCSkin' },
};

/** Propiedades físicas: id de la columna (`headers`) → campo. Unidades de EE. UU. (°F). */
const PHYSICAL_FIELDS: Record<string, string> = {
  phyDesc: 'physical.description',
  phyBoilPt: 'physical.boilingPoint',
  phyMolWeight: 'physical.molecularWeight',
  phyFreezePt: 'physical.freezingPoint',
  phyVapor: 'physical.vaporPressure',
  phyFlash: 'physical.flashPoint',
  phyVaporDensity: 'physical.vaporDensity',
  phySpecGrav: 'physical.specificGravity',
  phyIon: 'physical.ionizationPotential',
  phyExpLimit: 'physical.lowerExplosiveLimit',
  phyUpExpLimit: 'physical.upperExplosiveLimit',
  phyNFPA: 'hazard.nfpaHealth',
  phyFire: 'hazard.nfpaFire',
  phyTargetOrgs: 'health.targetOrgans',
};

export interface OshaSearchResult {
  id: string;
  name: string;
}

/** Parser PURO de la OSHA Occupational Chemical Database. */
export class OshaParser {
  static searchUrl(cas: string): string {
    return `${OSHA_BASE_URL}/chemicaldata/search?field_cas_number_value=${encodeURIComponent(cas)}`;
  }

  static chemicalUrl(id: string): string {
    return `${OSHA_BASE_URL}/chemicaldata/${id}`;
  }

  /** La búsqueda coincide por FRAGMENTO de CAS: solo valen las filas con el CAS exacto. */
  static parseSearch(html: string, cas: string): OshaSearchResult[] {
    const $ = cheerio.load(html);
    return $('table#chemicalTable tbody tr')
      .toArray()
      .filter((row) => clean($(row).find('td.views-field-field-cas-number').text()) === cas)
      .map((row) => {
        const link = $(row).find('td.views-field-title a[href^="/chemicaldata/"]').first();
        const id = /\/chemicaldata\/(\d+)/.exec(link.attr('href') ?? '')?.[1];
        return id ? { id, name: clean(link.text()).replace(/[†‡]/g, '').trim() } : null;
      })
      .filter((result): result is OshaSearchResult => result !== null);
  }

  /** Con varias entradas (FORMALDEHYDE y FORMALIN), la que no es solución/mezcla primero. */
  static pickBest(results: OshaSearchResult[]): OshaSearchResult | undefined {
    return results.find((r) => !/\bas\b|formalin|solution|%/i.test(r.name)) ?? results[0];
  }

  static parseChemical(html: string, sourceUrl: string): SourceRecord[] {
    const $ = cheerio.load(html);
    const records: SourceRecord[] = [];
    const add = (field: string, label: string, value: unknown) => {
      const empty =
        value === undefined ||
        value === '' ||
        (typeof value === 'object' && value !== null && !Object.values(value).some((v) => v !== undefined && v !== ''));
      if (!empty) records.push({ field, label, value, sourceUrl });
    };
    const cell = (headers: string) => clean($(`td[headers="${headers}"]`).first().text()) || undefined;

    add(
      'identity.name',
      'Name',
      clean($('#chemResultTables h3 strong, h3 strong').first().text()).replace(/[†‡]/g, '').trim(),
    );

    // ── Límites de exposición (sección 8) ────────────────────────────────────────
    for (const [agency, column] of Object.entries(AGENCIES) as Array<[keyof typeof AGENCIES, string]>) {
      const fields = LIMIT_FIELDS[agency];
      const notes = $(`td[headers="${column}"]`)
        .toArray()
        .map((td) => clean($(td).text()))
        .filter((text) => /^Notes:/i.test(text))
        .map((text) => clean(text.replace(/^Notes:/i, '')))
        .filter(Boolean);
      add(`exposure.osha.${agency}`, agency === 'acgihTlv' ? 'ACGIH TLV©' : agency, {
        twa: cell(`${column} ${fields.twa}`),
        stel: cell(`${column} ${fields.stel}`),
        ceiling: cell(`${column} ${fields.ceiling}`),
        skinNotation: cell(`${column} ${fields.skin}`),
        notes: notes.join(' ') || undefined,
      });
    }
    add('exposure.idlh', 'IDLH', cell('NioshRel Idlh'));

    // Clasificaciones de carcinogenicidad resumidas por OSHA (IARC-1, NIOSH-Ca, TLV-A1…).
    const carcinogenic = $('strong')
      .toArray()
      .find((strong) => /Carcinogenic classifications/i.test($(strong).text()));
    if (carcinogenic) {
      const text = clean($(carcinogenic).parent().text()).replace(/^.*Carcinogenic classifications:?/i, '');
      add('carcinogenicity.summary', 'Carcinogenic classifications', text.split(',').map(clean).filter(Boolean));
    }

    // ── Propiedades físicas (sección 9) ──────────────────────────────────────────
    for (const [header, field] of Object.entries(PHYSICAL_FIELDS)) {
      add(field, header, cell(header));
    }

    add(
      'meta.attribution',
      'Attribution',
      'OSHA Occupational Chemical Database (ACGIH TLV© values are copyrighted by ACGIH)',
    );
    return records;
  }
}

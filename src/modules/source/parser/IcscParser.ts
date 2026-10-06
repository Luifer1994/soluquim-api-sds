import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { SourceRecord } from '@/modules/source/dto';

export const ICSC_BASE_URL = 'https://chemicalsafety.ilo.org/dyn/icsc/';

export interface IcscSearchResult {
  cardId: string;
  version: string;
  name: string;
}

/** Quita tildes y pasa a minúsculas: los títulos se comparan igual en español e inglés. */
const normalize = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const clean = (text: string): string =>
  text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Título de sección (normalizado, ES y EN) → campo. */
const SECTION_FIELDS: Record<string, string> = {
  'derrames y fugas': 'spill.measures',
  'spillage disposal': 'spill.measures',
  almacenamiento: 'storage.conditions',
  storage: 'storage.conditions',
  envasado: 'storage.packaging',
  packaging: 'storage.packaging',
  'medio ambiente': 'ecology.environment',
  environment: 'ecology.environment',
  notas: 'notes',
  notes: 'notes',
  'informacion adicional': 'regulatory.additionalInformation',
  'additional information': 'regulatory.additionalInformation',
};

/** Vía de exposición (ES/EN) → clave. */
const ROUTES: Record<string, string> = {
  inhalacion: 'inhalation',
  inhalation: 'inhalation',
  piel: 'skin',
  skin: 'skin',
  ojos: 'eyes',
  eyes: 'eyes',
  ingestion: 'ingestion',
};

/** Etiqueta (prefijo normalizado, ES/EN) de la tabla físico-química → campo. Orden: los más específicos primero. */
const PHYSICAL_FIELDS: Array<[string, string]> = [
  ['formula', 'identity.formula'],
  ['masa molecular', 'physical.molecularWeight'],
  ['molecular mass', 'physical.molecularWeight'],
  ['punto de ebullicion', 'physical.boilingPoint'],
  ['boiling point', 'physical.boilingPoint'],
  ['punto de fusion', 'physical.meltingPoint'],
  ['melting point', 'physical.meltingPoint'],
  ['densidad relativa de la mezcla', 'physical.relativeVaporAirMixtureDensity'],
  ['relative density of the vapour/air', 'physical.relativeVaporAirMixtureDensity'],
  ['densidad relativa de vapor', 'physical.relativeVaporDensity'],
  ['relative vapour density', 'physical.relativeVaporDensity'],
  ['densidad relativa', 'physical.relativeDensity'],
  ['relative density', 'physical.relativeDensity'],
  ['densidad', 'physical.density'],
  ['density', 'physical.density'],
  ['solubilidad en agua', 'physical.waterSolubility'],
  ['solubility in water', 'physical.waterSolubility'],
  ['presion de vapor', 'physical.vaporPressure'],
  ['vapour pressure', 'physical.vaporPressure'],
  ['punto de inflamacion', 'physical.flashPoint'],
  ['flash point', 'physical.flashPoint'],
  ['temperatura de autoignicion', 'physical.autoIgnitionTemperature'],
  ['auto-ignition temperature', 'physical.autoIgnitionTemperature'],
  ['limites de explosividad', 'physical.explosiveLimits'],
  ['explosive limits', 'physical.explosiveLimits'],
  ['coeficiente de reparto octanol/agua', 'physical.logPow'],
  ['octanol/water partition coefficient', 'physical.logPow'],
  ['viscosidad', 'physical.viscosity'],
  ['viscosity', 'physical.viscosity'],
];

/** Bloques `<p><b>Título</b> texto` (columna izquierda de físico-química y efectos sobre la salud). */
const BLOCK_FIELDS: Array<[string, string]> = [
  ['estado fisico', 'physical.appearance'],
  ['physical state', 'physical.appearance'],
  ['peligros fisicos', 'physical.physicalDangers'],
  ['physical dangers', 'physical.physicalDangers'],
  ['peligros quimicos', 'reactivity.chemicalDangers'],
  ['chemical dangers', 'reactivity.chemicalDangers'],
  ['vias de exposicion', 'health.routesOfExposure'],
  ['routes of exposure', 'health.routesOfExposure'],
  ['efectos de exposicion de corta duracion', 'health.shortTermEffects'],
  ['effects of short-term exposure', 'health.shortTermEffects'],
  ['riesgo de inhalacion', 'health.inhalationRisk'],
  ['inhalation risk', 'health.inhalationRisk'],
  ['efectos de exposicion prolongada', 'health.longTermEffects'],
  ['effects of long-term', 'health.longTermEffects'],
];

/** Nombre del archivo del pictograma de la ICSC → código SGA. */
const PICTOGRAMS: Array<[RegExp, string]> = [
  [/explos/i, 'GHS01'],
  [/rondflam/i, 'GHS03'],
  [/flamme|flame/i, 'GHS02'],
  [/bottle|gas/i, 'GHS04'],
  [/acid|corros/i, 'GHS05'],
  [/skull|tete/i, 'GHS06'],
  [/exclam/i, 'GHS07'],
  [/silhou/i, 'GHS08'],
  [/aquatic|environ|pollut/i, 'GHS09'],
];

/**
 * Parser PURO de las Fichas Internacionales de Seguridad Química (ICSC, OIT/OMS), en español o inglés.
 * El HTML es antiguo (tablas, sin ids ni clases, etiquetas sin cerrar): las secciones se ubican por el
 * texto de su `th`, nunca por posición.
 */
export class IcscParser {
  /** Resultado de `showcard.listCards3?p_cas_number=…`: una fila por ficha. */
  static parseSearch(html: string): IcscSearchResult[] {
    const $ = cheerio.load(html);
    return $('tr[valign="top"]')
      .toArray()
      .map((row) => {
        const link = $(row).find('a[href*="showcard.display"]').first();
        const href = link.attr('href') ?? '';
        const cardId = /p_card_id=(\d+)/.exec(href)?.[1];
        const version = /p_version=(\d+)/.exec(href)?.[1] ?? '2';
        const nameCell = $(row).find('td').eq(1).clone();
        nameCell.find('span').remove();
        return cardId ? { cardId, version, name: clean(nameCell.text()) } : null;
      })
      .filter((result): result is IcscSearchResult => result !== null);
  }

  /** Con varias fichas para un CAS, la de la sustancia pura (sin "%", "solución"…) primero. */
  static pickBest(results: IcscSearchResult[]): IcscSearchResult | undefined {
    const isPure = (name: string) => !/%|solution|solucion|disolucion|mixture|mezcla/i.test(normalize(name));
    return results.find((r) => isPure(r.name)) ?? results[0];
  }

  static isCardNotFound(html: string): boolean {
    return html.length < 500 || /card not found/i.test(html.slice(0, 200));
  }

  static parseCard(html: string, sourceUrl: string, language: string): SourceRecord[] {
    const $ = cheerio.load(html);
    const records: SourceRecord[] = [];
    const add = (field: string, label: string, value: unknown) => {
      const empty =
        value === undefined ||
        value === '' ||
        (Array.isArray(value) && !value.length) ||
        (typeof value === 'object' && value !== null && !Array.isArray(value) && !Object.keys(value).length);
      if (!empty) records.push({ field, label, value, sourceUrl });
    };
    const textWithBreaks = (element: Element): string[] => {
      const copy = $(element).clone();
      copy.find('br').replaceWith('\n');
      copy.find('sub, sup').each((_, node) => {
        $(node).replaceWith($(node).text());
      });
      return copy.text().split('\n').map(clean).filter(Boolean);
    };

    add('meta.language', 'Idioma de la ficha', language);

    // ── Encabezado: nombre, número/fecha de la ficha, sinónimos ─────────────────
    const header = $('table[bgcolor="#E25C5C"]').first();
    const headerCells = header.find('tr').first().find('td');
    add('identity.name', 'Nombre', clean(headerCells.eq(0).text()));
    add('meta.icscCard', 'Ficha ICSC', clean(headerCells.eq(1).text()).replace(/^ICSC\s*:\s*/i, ''));
    const synonymsCell = header.find('tr').eq(1).find('td').get(0);
    if (synonymsCell) add('identity.synonyms', 'Sinónimos', textWithBreaks(synonymsCell));

    // ── Identificadores: CAS, Nº ONU, CE ─────────────────────────────────────────
    const ids = clean($('body').text());
    add('identity.cas', 'CAS', /CAS(?:\s*#)?\s*:\s*(\d{2,7}-\d{2}-\d)/i.exec(ids)?.[1]);
    add('transport.unNumber', 'Nº ONU', /(?:UN\s*#|N[ºo°]\s*ONU)\s*:\s*(\d{4})/i.exec(ids)?.[1]);
    add('identity.ecNumber', 'CE', /(?:EC Number|\bCE)\s*:\s*(\d{3}-\d{3}-\d)/i.exec(ids)?.[1]);

    // ── Incendio y explosión (secciones 5 y 7) ───────────────────────────────────
    const fireRow = $('th')
      .filter((_, th) => /^(incendio y explosion|fire & explosion)$/.test(normalize($(th).text())))
      .first()
      .closest('tr');
    const fireCells = fireRow.find('td');
    add('fire.hazards', 'Peligros de incendio y explosión', clean(fireCells.eq(0).text()));
    add('fire.prevention', 'Prevención de incendios', clean(fireCells.eq(1).text()));
    add('fire.extinguishing', 'Lucha contra incendios', clean(fireCells.eq(2).text()));

    // ── Exposición por vía: síntomas / prevención / primeros auxilios (secciones 4, 8, 11) ─
    const exposureTable = $('th')
      .filter((_, th) => /^(sintomas|symptoms)$/.test(normalize($(th).text())))
      .first()
      .closest('table');
    const byRoute: Record<string, { symptoms: string; prevention: string; firstAid: string }> = {};
    exposureTable.find('tr').each((_, row) => {
      const route = ROUTES[normalize($(row).children('th').first().text())];
      const cells = $(row).children('td');
      if (route && cells.length >= 3) {
        byRoute[route] = {
          symptoms: clean(cells.eq(0).text()),
          prevention: clean(cells.eq(1).text()),
          firstAid: clean(cells.eq(2).text()),
        };
      }
    });
    add('exposure.byRoute', 'Exposición por vía (síntomas, prevención, primeros auxilios)', byRoute);
    add(
      'firstAid.byRoute',
      'Primeros auxilios por vía',
      Object.fromEntries(Object.entries(byRoute).map(([route, data]) => [route, data.firstAid])),
    );
    add('exposure.generalWarning', 'Advertencia general', clean(exposureTable.find('th[colspan="4"]').first().text()));

    // ── Secciones de un solo bloque: derrames, almacenamiento, medio ambiente, notas… ─
    $('th').each((_, th) => {
      const title = normalize($(th).text());
      const field = SECTION_FIELDS[title];
      if (!field) return;
      const content = IcscParser.cellBelow($, th);
      if (content) add(field, clean($(th).text()), textWithBreaks(content).join(' '));
    });

    // ── Clasificación y etiquetado SGA + transporte (secciones 2 y 14) ───────────
    const labellingTh = $('th')
      .filter((_, th) => /^(clasificacion y etiquetado|classification & labelling)$/.test(normalize($(th).text())))
      .get(0);
    const labelling = labellingTh ? IcscParser.cellBelow($, labellingTh) : undefined;
    if (labelling) {
      const $labelling = $(labelling);
      const pictograms = $labelling
        .find('img[src*="ghs-pictograms"]')
        .toArray()
        .map((img) => {
          const file = $(img).attr('src')?.split('/').pop() ?? '';
          return { code: PICTOGRAMS.find(([pattern]) => pattern.test(file))?.[1] ?? file, file };
        });
      const signalWord = clean($labelling.find('div[align="center"] strong').first().text());
      const lines = textWithBreaks(labelling);
      const signalIndex = lines.findIndex((line) => line === signalWord);
      const transportIndex = lines.findIndex((line) => /^(transporte|transportation)$/i.test(line));
      const statements = lines.slice(signalIndex + 1, transportIndex < 0 ? undefined : transportIndex);
      const transport = transportIndex < 0 ? '' : lines.slice(transportIndex + 1).join(' ');

      add('ghs.icsc', 'Clasificación SGA (ICSC)', {
        criteria: lines[0],
        pictograms,
        signalWord: signalWord || undefined,
        hazardStatements: statements,
      });
      add(
        'transport.unHazardClass',
        'Clase de peligro ONU',
        /(?:Clase de Peligro ONU|UN Hazard Class)\s*:\s*([\d.]+)/i.exec(transport)?.[1],
      );
      add(
        'transport.packingGroup',
        'Grupo de embalaje ONU',
        /(?:Grupo de Embalaje\/Envase ONU|UN Pack Group)\s*:\s*([IV]+)/i.exec(transport)?.[1],
      );
    }

    // ── Información físico-química (sección 9) y efectos sobre la salud (sección 11) ─
    for (const title of [
      /^(informacion fisico-quimica|physical & chemical information)$/,
      /^(exposicion y efectos sobre la salud|exposure & health effects)$/,
    ]) {
      const th = $('th')
        .filter((_, cell) => title.test(normalize($(cell).text())))
        .get(0);
      const cells = th ? $(th).closest('tr').next('tr').children('td').toArray() : [];
      for (const cell of cells) {
        // Bloques <p><b>Título</b> texto
        $(cell)
          .find('p')
          .each((_, paragraph) => {
            const label = clean($(paragraph).find('b').first().text());
            const field = BLOCK_FIELDS.find(([prefix]) => normalize(label).startsWith(prefix))?.[1];
            const value = clean($(paragraph).text().replace(label, ''));
            if (label && value) add(field ?? `other.${normalize(label).replace(/[^a-z0-9]+/g, '_')}`, label, value);
          });
        // Líneas "Clave: valor"
        for (const line of textWithBreaks(cell)) {
          const separator = line.indexOf(':');
          if (separator < 0) continue;
          const key = normalize(line.slice(0, separator));
          const field = PHYSICAL_FIELDS.find(([prefix]) => key.startsWith(prefix))?.[1];
          if (field) add(field, clean(line.slice(0, separator)), clean(line.slice(separator + 1)));
        }
      }
    }

    // ── Límites de exposición laboral (sección 8) ────────────────────────────────
    const oelTh = $('th')
      .filter((_, th) => /^(limites de exposicion laboral|occupational exposure limits)$/.test(normalize($(th).text())))
      .get(0);
    const oel = oelTh ? IcscParser.cellBelow($, oelTh) : undefined;
    if (oel) add('exposure.occupationalLimits', 'Límites de exposición laboral', textWithBreaks(oel));

    return records;
  }

  /**
   * La celda de contenido de un título: misma columna en la fila siguiente. Si esa fila tiene menos
   * celdas (por un rowspan de la fila anterior), la primera.
   */
  private static cellBelow($: cheerio.CheerioAPI, th: Element): Element | undefined {
    const row = $(th).closest('tr');
    const column = row.children('th, td').index(th);
    const next = row.next('tr').children('td');
    return next.get(column) ?? next.get(0);
  }
}

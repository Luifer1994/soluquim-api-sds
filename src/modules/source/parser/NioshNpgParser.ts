import * as cheerio from 'cheerio';
import { isTag } from 'domhandler';
import type { AnyNode, Element } from 'domhandler';
import { SourceRecord } from '@/modules/source/dto';

export const NIOSH_NPG_BASE_URL = 'https://www.cdc.gov/niosh/npg/';

export interface NioshIndexEntry {
  page: string;
  name: string;
}

type CardKind = 'text' | 'list' | 'keyValue' | 'exposureLimits' | 'dotGuide' | 'paragraphs';

/** Título de la tarjeta en la ficha → campo normalizado. Lo que no esté aquí sale como `other.<slug>`. */
const CARD_FIELDS: Record<string, { field: string; kind?: CardKind }> = {
  'synonyms & trade names': { field: 'identity.synonyms', kind: 'list' },
  'cas no.': { field: 'identity.cas' },
  'rtecs no.': { field: 'identity.rtecs' },
  'dot id & guide': { field: 'transport.dotIdAndGuide', kind: 'dotGuide' },
  formula: { field: 'identity.formula' },
  conversion: { field: 'exposure.conversion' },
  idlh: { field: 'exposure.idlh' },
  'exposure limits': { field: 'exposure.limits', kind: 'exposureLimits' },
  'measurement methods': { field: 'exposure.measurementMethods' },
  'physical description': { field: 'physical.description' },
  'molecular weight': { field: 'physical.molecularWeight' },
  'boiling point': { field: 'physical.boilingPoint' },
  'freezing point': { field: 'physical.freezingPoint' },
  'melting point': { field: 'physical.meltingPoint' },
  solubility: { field: 'physical.solubility' },
  'vapor pressure': { field: 'physical.vaporPressure' },
  'ionization potential': { field: 'physical.ionizationPotential' },
  'specific gravity': { field: 'physical.specificGravity' },
  'relative gas density': { field: 'physical.relativeGasDensity' },
  'flash point': { field: 'physical.flashPoint' },
  'upper explosive limit': { field: 'physical.upperExplosiveLimit' },
  'lower explosive limit': { field: 'physical.lowerExplosiveLimit' },
  'incompatibilities & reactivities': { field: 'reactivity.incompatibilities' },
  'exposure routes': { field: 'health.exposureRoutes' },
  symptoms: { field: 'health.symptoms' },
  'target organs': { field: 'health.targetOrgans' },
  'cancer site': { field: 'health.cancerSite' },
  'personal protection/sanitation': { field: 'protection.personal', kind: 'keyValue' },
  'first aid': { field: 'firstAid.measures', kind: 'keyValue' },
  'respirator recommendations': { field: 'protection.respirator', kind: 'paragraphs' },
};

/** Límites dentro de la tarjeta "Exposure Limits" (subtítulos <h6>). */
const EXPOSURE_LIMIT_FIELDS: Record<string, string> = {
  'niosh rel': 'exposure.nioshRel',
  'osha pel': 'exposure.oshaPel',
};

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();
/** Quita los enlaces de ayuda: "(See protection codes)", "(See procedures)" y el "See: …" final (IDLH, métodos). */
const stripHelpLinks = (text: string): string =>
  clean(
    clean(text)
      .replace(/\(\s*See [^)]*\)/gi, '')
      .replace(/\s*See:\s.*$/i, ''),
  );
const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)?/g, (_, chr: string | undefined) => (chr ? chr.toUpperCase() : ''))
    .replace(/^./, (c) => c.toLowerCase());

/**
 * Parser PURO de la NIOSH Pocket Guide (HTML, sin red): se prueba con fixtures reales.
 * La ficha está hecha de tarjetas `.card` con `.card-title` + `.card-body`: se recorren por título,
 * así un cambio de orden o una tarjeta nueva no rompe el parseo.
 */
export class NioshNpgParser {
  /** Índice por CAS (npgdcas.html): filas `<tr><td>CAS</td><td><a href='npgdNNNN.html'>Nombre</a></td></tr>`. */
  static parseCasIndex(html: string): Map<string, NioshIndexEntry[]> {
    const $ = cheerio.load(html);
    const index = new Map<string, NioshIndexEntry[]>();

    $('tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 2) return;
      const cas = clean(cells.eq(0).text());
      const link = cells.eq(1).find('a').first();
      const page = link.attr('href')?.trim();
      if (!/^\d{2,7}-\d{2}-\d$/.test(cas) || !page) return;

      const entries = index.get(cas) ?? [];
      entries.push({ page, name: clean(link.text()) });
      index.set(cas, entries);
    });
    return index;
  }

  static parseChemicalPage(html: string, sourceUrl: string): SourceRecord[] {
    const $ = cheerio.load(html);
    // <br> → espacio (si no, "[10%LEL]<br/>See" queda pegado) y <sup> sin espacios ("mg/m<sup>3</sup>" → "mg/m3").
    $('br').replaceWith(' ');
    $('sup').each((_, sup) => {
      $(sup).replaceWith($(sup).text());
    });
    const records: SourceRecord[] = [];
    const add = (field: string, label: string, value: unknown) => {
      const empty = value === '' || value === undefined || (Array.isArray(value) && !value.length);
      const emptyObject = typeof value === 'object' && value !== null && !Object.keys(value).length;
      if (!empty && !emptyObject) records.push({ field, label, value, sourceUrl });
    };

    add('identity.name', 'Name', clean($('main h1').first().text()));

    const notes: string[] = [];
    $('main .card').each((_, card) => {
      const $card = $(card);
      const title = clean($card.children('.card-title').first().text());
      const $body = $card.children('.card-body').first();
      if (!$body.length) return;

      if (!title) {
        const note = stripHelpLinks($body.text());
        if (note) notes.push(note);
        return;
      }

      const mapping = CARD_FIELDS[title.toLowerCase()] ?? { field: `other.${slug(title)}` };
      switch (mapping.kind ?? 'text') {
        case 'list':
          add(
            mapping.field,
            title,
            clean($body.text())
              .split(/\s*,\s*/)
              .filter(Boolean),
          );
          break;
        case 'keyValue':
          add(mapping.field, title, NioshNpgParser.parseKeyValues($, $body.get(0)!));
          break;
        case 'paragraphs':
          // Un elemento por <p>: "NIOSH/OSHA", "Up to 3300 ppm: (APF = 10) …", "Emergency …".
          add(
            mapping.field,
            title,
            $body
              .find('p')
              .toArray()
              .map((paragraph) => stripHelpLinks($(paragraph).text()))
              .filter(Boolean),
          );
          break;
        case 'dotGuide': {
          // "1170 127" → número ONU 1170 (sección 14 de la FDS) y guía ERG 127.
          const [unNumber, ergGuide] = clean($body.text()).split(' ');
          add('transport.unNumber', 'DOT ID (UN number)', unNumber);
          add('transport.ergGuide', 'Emergency Response Guide', ergGuide);
          break;
        }
        case 'exposureLimits':
          for (const [subtitle, value] of Object.entries(NioshNpgParser.parseSubsections($, $body.get(0)!))) {
            add(EXPOSURE_LIMIT_FIELDS[subtitle.toLowerCase()] ?? `exposure.${slug(subtitle)}`, subtitle, value);
          }
          break;
        default:
          add(mapping.field, title, stripHelpLinks($body.text()));
      }
    });

    add('notes', 'Notes', notes);
    return records;
  }

  /** `<h6>NIOSH REL</h6>TWA 1000 ppm<br/><h6>OSHA PEL</h6>…` → { 'NIOSH REL': 'TWA 1000 ppm', … } */
  private static parseSubsections($: cheerio.CheerioAPI, body: Element): Record<string, string> {
    const result: Record<string, string> = {};
    let current: string | undefined;
    const walk = (nodes: AnyNode[]) => {
      for (const node of nodes) {
        if (isTag(node) && node.name === 'h6') {
          current = clean($(node).text());
          result[current] = '';
        } else if (isTag(node) && node.name !== 'h6' && $(node).find('h6').length) {
          walk($(node).contents().toArray());
        } else if (current) {
          result[current] += $(node).text();
        }
      }
    };
    walk($(body).contents().toArray());
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, clean(value)]));
  }

  /** `<strong>Skin:</strong>Prevent skin contact<br/>…` → { Skin: 'Prevent skin contact', … } */
  private static parseKeyValues($: cheerio.CheerioAPI, body: Element): Record<string, string> {
    const result: Record<string, string> = {};
    let current: string | undefined;
    for (const node of $(body).contents().toArray()) {
      if (isTag(node) && node.name === 'strong') {
        current = clean($(node).text()).replace(/:$/, '');
        result[current] = '';
      } else if (current) {
        result[current] += $(node).text();
      }
    }
    return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, clean(value)]));
  }
}

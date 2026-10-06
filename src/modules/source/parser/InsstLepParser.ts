import * as cheerio from 'cheerio';
import { SourceRecord } from '@/modules/source/dto';

export const INSST_LEP_BASE_URL = 'https://bdlep.insst.es/LEP/';

const clean = (text: string): string =>
  text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** "---" = sin valor. */
const valueOrNull = (text: string): string | null => {
  const cleaned = clean(text);
  return cleaned && cleaned !== '---' ? cleaned : null;
};

/**
 * Parser PURO de la base de datos de Límites de Exposición Profesional (LEP) del INSST (España):
 * VLA-ED (exposición diaria, 8 h) y VLA-EC (exposición de corta duración, 15 min) en ppm y mg/m³.
 */
export class InsstLepParser {
  /** Búsqueda por CAS → enlace a la ficha del agente (`vlapr.jsp?ID=…&nombre=…`). */
  static parseSearch(html: string, cas: string): string | undefined {
    const $ = cheerio.load(html);
    const row = $('table.listado tr')
      .toArray()
      .find((tr) => clean($(tr).children('td').first().text()) === cas);
    return row ? $(row).find('a[href^="vlapr.jsp"]').attr('href') : undefined;
  }

  static parseAgent(html: string, sourceUrl: string): SourceRecord[] {
    const $ = cheerio.load(html);
    const records: SourceRecord[] = [];
    const add = (field: string, label: string, value: unknown) => {
      if (value !== undefined && value !== null && value !== '') records.push({ field, label, value, sourceUrl });
    };

    const highlighted = $('span.destacado')
      .toArray()
      .map((span) => clean($(span).text()));
    add('identity.name', 'Agente químico', clean($('h2.alt2').first().text()));
    add('identity.cas', 'Nº CAS', highlighted[0]);
    add('identity.ecNumber', 'Nº CE', highlighted[1]);
    add('regulatory.insstYear', 'Año de incorporación o actualización', highlighted[2]);

    // Fila de valores: VLA-ED ppm | VLA-ED mg/m³ | VLA-EC ppm | VLA-EC mg/m³
    const values = $('table.valores tr')
      .not('.cabecera')
      .first()
      .children('td')
      .toArray()
      .map((td) => valueOrNull($(td).text()));
    const limits = {
      vlaEd: { ppm: values[0] ?? null, mgM3: values[1] ?? null },
      vlaEc: { ppm: values[2] ?? null, mgM3: values[3] ?? null },
    };
    const hasAny = [limits.vlaEd.ppm, limits.vlaEd.mgM3, limits.vlaEc.ppm, limits.vlaEc.mgM3].some(Boolean);
    if (hasAny) add('exposure.oel.es', 'Valores Límite Ambientales (INSST, España)', limits);

    const hCodes = clean($('a[href^="fhpr.jsp"]').first().text());
    if (hCodes) {
      add(
        'ghs.hazardStatementCodes',
        'Indicaciones de peligro H',
        hCodes.split('-').map((code) => (/^\d/.test(code) ? `H${code}` : code)),
      );
    }

    const notes = $('td.content_centrado')
      .toArray()
      .map((cell) => ({ code: clean($(cell).text()), text: clean($(cell).next('td.content_right').text()) }))
      .filter((note) => note.text);
    add('regulatory.insstNotes', 'Notas', notes.length ? notes : undefined);
    add('meta.attribution', 'Attribution', 'Límites de Exposición Profesional para Agentes Químicos — INSST (España)');
    return records;
  }
}

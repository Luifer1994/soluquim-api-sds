import JSON5 from 'json5';

/** Un agente evaluado por la IARC tal como viene en su listado. */
export interface IarcAgent {
  name: string;
  /** "1", "2A", "2B" o "3". Falta en las referencias cruzadas ("X (see Y)"). */
  group?: string;
  cas?: string[];
  volume?: string[];
  year?: number | string;
  yeareval?: number | string;
  comment?: string;
  in_prep?: boolean;
}

export interface IarcDataset {
  lastVolume: string;
  lastUpdate: string;
  agents: IarcAgent[];
}

/** Grupos IARC en orden de mayor a menor peso de la evidencia. */
export const IARC_GROUP_DESCRIPTIONS: Record<string, string> = {
  '1': 'Carcinógeno para los seres humanos',
  '2A': 'Probablemente carcinógeno para los seres humanos',
  '2B': 'Posiblemente carcinógeno para los seres humanos',
  '3': 'No clasificable en cuanto a su carcinogenicidad para los seres humanos',
};

const MARKER = 'e.exports={last_volume:';

/**
 * Parser PURO del listado de clasificaciones IARC.
 *
 * La IARC no publica un CSV: la página carga `loc.app.js`, que trae TODO el listado como un literal
 * de objeto JS. Se extrae ese literal y se parsea como DATO (JSON5), nunca se ejecuta el código
 * descargado. Lo único que no es JSON5 son los booleanos minificados (`!0` / `!1`).
 */
export class IarcParser {
  static parseBundle(js: string): IarcDataset {
    const start = js.indexOf(MARKER);
    if (start < 0) throw new Error('No se encontró el listado de la IARC en loc.app.js (¿cambió el bundle?)');

    const literal = IarcParser.extractObjectLiteral(js, start + 'e.exports='.length)
      .replace(/:!0\b/g, ':true')
      .replace(/:!1\b/g, ':false');

    const parsed = JSON5.parse<{ last_volume: string; last_update: string; agents: IarcAgent[] }>(literal);
    if (!Array.isArray(parsed.agents) || parsed.agents.length < 500) {
      throw new Error(`Listado IARC sospechoso: ${parsed.agents?.length ?? 0} agentes`);
    }
    return { lastVolume: parsed.last_volume, lastUpdate: parsed.last_update, agents: parsed.agents };
  }

  /** CAS → agentes (un CAS puede tener varios: "Acetaldehyde" 2B y "…in alcoholic beverages" 1). */
  static indexByCas(dataset: IarcDataset): Map<string, IarcAgent[]> {
    const index = new Map<string, IarcAgent[]>();
    for (const agent of dataset.agents) {
      if (!agent.group) continue; // referencias cruzadas sin clasificación propia
      for (const cas of agent.cas ?? []) {
        const list = index.get(cas.trim()) ?? [];
        list.push(agent);
        index.set(cas.trim(), list);
      }
    }
    return index;
  }

  static stripHtml(text: string | undefined): string | undefined {
    const cleaned = text
      ?.replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || undefined;
  }

  /** Recorta `{ … }` desde `from`, contando llaves y respetando strings ("…", '…'). */
  private static extractObjectLiteral(source: string, from: number): string {
    let depth = 0;
    let quote: string | null = null;
    for (let i = from; i < source.length; i++) {
      const char = source[i];
      if (quote) {
        if (char === '\\') i++;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) return source.slice(from, i + 1);
    }
    throw new Error('Literal del listado IARC sin cerrar');
  }
}

import { GHS_STATEMENTS_ES } from '@/modules/knowledge/catalog/GhsStatementsEs';

export interface GhsStatement {
  /** H225, EUH066, P210, P303+P361+P353… */
  code: string;
  /** Texto de la frase; null si no se conoce (ni en el catálogo ni en el valor). */
  text: string | null;
}

const CODE = /\b(EUH\d{3}[A-Z]?|H\d{3}[A-Za-z]{0,3}|P\d{3}(?:\s*\+\s*P\d{3})*)(?![\w+])/g;
/** Variantes de toxicidad para la reproducción que especifican el efecto (fertilidad F/f, feto D/d). */
const VARIANTS_ES: Readonly<Record<string, string>> = {
  H360F: 'Puede perjudicar la fertilidad',
  H360D: 'Puede dañar al feto',
  H360FD: 'Puede perjudicar la fertilidad. Puede dañar al feto',
  H361F: 'Susceptible de perjudicar la fertilidad',
  H361D: 'Susceptible de dañar al feto',
  H361FD: 'Susceptible de perjudicar la fertilidad. Susceptible de dañar al feto',
};

const SIGNAL_WORDS: Array<{ pattern: RegExp; es: string; en: string }> = [
  { pattern: /danger|peligro/i, es: 'Peligro', en: 'Danger' },
  { pattern: /warning|atenci[oó]n/i, es: 'Atención', en: 'Warning' },
];

/**
 * Frases H / EUH / P y palabra de advertencia del SGA (funciones puras). En español el texto de cada
 * frase sale del catálogo oficial; en otro idioma se conserva el que traía el valor (el de la fuente).
 */
export class GhsStatementCatalog {
  /**
   * Texto oficial de la frase. Las variantes con letra (H361d, H360FD…) se buscan tal cual, luego en
   * mayúsculas y por último se usa el texto de la frase base (H361) si la variante no está en el catálogo.
   */
  static text(code: string, language: string): string | null {
    if (language !== 'es') return null;
    const key = code.replace(/\s/g, '');
    return (
      VARIANTS_ES[key.toUpperCase()] ??
      GHS_STATEMENTS_ES[key] ??
      GHS_STATEMENTS_ES[key.toUpperCase()] ??
      GHS_STATEMENTS_ES[key.replace(/[A-Za-z]+$/, '')] ??
      null
    );
  }

  /** Frases de un texto libre, sin repetir y en el orden en que aparecen, cada una con su texto. */
  static parse(value: string | null | undefined, language: string): GhsStatement[] {
    if (!value) return [];
    const matches = [...value.matchAll(CODE)];
    const statements = new Map<string, GhsStatement>();
    matches.forEach((match, index) => {
      const code = match[1].replace(/\s/g, '');
      const start = match.index + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index : value.length;
      // Lo que sigue al código hasta la próxima frase o el fin de la línea: el texto que traía la fuente.
      const trailing = value
        .slice(start, end)
        .split('\n')[0]
        .replace(/^[\s:—–\-.)\]]+/, '')
        .replace(/[\s;,([]+$/, '')
        .trim();
      const text = GhsStatementCatalog.text(code, language) ?? (trailing.length > 3 ? trailing : null);
      const known = statements.get(code);
      if (!known || (!known.text && text)) statements.set(code, { code, text });
    });
    return [...statements.values()];
  }

  /** "H225 Líquido y vapores muy inflamables", una frase por línea. */
  static render(statements: GhsStatement[]): string {
    return statements.map((s) => (s.text ? `${s.code} ${s.text}` : s.code)).join('\n');
  }

  /** "Danger", "PELIGRO"… → la palabra de advertencia en el idioma de la ficha. Lo desconocido queda igual. */
  static signalWord(value: string, language: string): string {
    const word = SIGNAL_WORDS.find((w) => w.pattern.test(value));
    return word ? (language === 'en' ? word.en : word.es) : value;
  }
}

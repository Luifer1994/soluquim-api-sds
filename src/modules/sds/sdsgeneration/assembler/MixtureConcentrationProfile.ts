import { CurrentSourceData } from '@/modules/substance';

export interface MixtureComponentInput {
  cas: string;
  name: string | null;
  /** El valor con el que se compara cada límite: el máximo posible de su concentración. */
  percentage: number;
  /** La concentración como la declaró el usuario ("≤ 99 %"), para mostrarla. */
  concentration?: string;
}

/** Cómo entra una clase de peligro de un componente en la clasificación de la mezcla. */
export type ContributionVerdict =
  /** Alcanza el límite (específico o genérico): el peligro pasa a la mezcla. */
  | 'reaches'
  /** Por debajo del límite: por sí solo no pasa a la mezcla. */
  | 'below'
  /** Entre los dos límites que admite el SGA (0,1 % / 3 %…): depende del criterio que adopte la autoridad. */
  | 'authority-dependent'
  /** Se suma con los demás componentes (regla de adición, sumatoria con factor M, ETA). */
  | 'additive'
  /** No depende del %: se determina con ensayos de la mezcla (punto de inflamación…). */
  | 'not-by-concentration';

export interface HazardContribution {
  /** "Carc. 1B", "Eye Irrit. 2". */
  hazardClass: string;
  hazardStatements: string[];
  /** De dónde salió la clase: clasificación armonizada (CLP Anexo VI) o notificada por la industria. */
  origin: 'harmonised' | 'notified';
  /** El límite que se aplicó, como se le explica al agente. */
  limit: string;
  limitKind: 'specific' | 'generic' | 'rule';
  verdict: ContributionVerdict;
}

export interface ComponentConcentrationProfile {
  cas: string;
  name: string | null;
  percentage: number;
  concentration?: string;
  contributions: HazardContribution[];
  /** Factores M (peligro acuático), si los hay. */
  mFactors?: { acute?: number; chronic?: number };
  /** ETA armonizadas, para la fórmula de toxicidad aguda de la mezcla. */
  acuteToxicityEstimates: string[];
}

interface HazardClassEntry {
  code?: string;
  hazardStatements?: Array<{ code?: string }>;
}
interface HarmonisedEntry {
  status?: string;
  hazardClasses?: HazardClassEntry[];
  specificConcentrationLimits?: Array<{ range?: string; hazardClasses?: string[] }>;
  mFactors?: { acute?: number; chronic?: number } | null;
  acuteToxicityEstimates?: Array<{ route?: string; value?: number; unit?: string }>;
}
interface NotifiedValue {
  dominant?: { hazardClasses?: HazardClassEntry[] };
}

type GenericRule =
  | { type: 'threshold'; limit: number; text: string }
  | { type: 'dual'; low: number; high: number; text: string }
  | { type: 'additive'; text: string }
  | { type: 'physical'; text: string };

/**
 * Límites genéricos de concentración del SGA (Rev. 6, capítulos 3.x) para clasificar una mezcla a partir
 * de sus componentes. Las clases físicas no se calculan por %: dependen de ensayos de la mezcla.
 * Orden importa: la primera coincidencia por prefijo gana (las más específicas primero).
 */
const GENERIC_RULES: ReadonlyArray<[prefix: string, rule: GenericRule]> = [
  ['Acute Tox.', { type: 'additive', text: 'fórmula de aditividad (ETA de la mezcla); entran los componentes ≥ 1 %' }],
  [
    'Skin Corr. 1',
    { type: 'additive', text: 'regla de adición: suma ≥ 5 % → corrosión cat. 1; 1–5 % → irritación cat. 2' },
  ],
  ['Skin Irrit. 2', { type: 'additive', text: 'regla de adición: suma ≥ 10 % → cat. 2; 1–10 % → cat. 3 del SGA' }],
  ['Skin Irrit. 3', { type: 'additive', text: 'regla de adición: suma ≥ 10 % → cat. 3' }],
  ['Eye Dam. 1', { type: 'additive', text: 'regla de adición: suma ≥ 3 % → cat. 1; 1–3 % → cat. 2' }],
  ['Eye Irrit. 2', { type: 'additive', text: 'regla de adición: suma ≥ 10 % → cat. 2' }],
  ['Resp. Sens. 1A', { type: 'threshold', limit: 0.1, text: 'límite genérico 0,1 %' }],
  ['Skin Sens. 1A', { type: 'threshold', limit: 0.1, text: 'límite genérico 0,1 %' }],
  ['Resp. Sens. 1', { type: 'threshold', limit: 1, text: 'límite genérico 1 %' }],
  ['Skin Sens. 1', { type: 'threshold', limit: 1, text: 'límite genérico 1 %' }],
  ['Muta. 1', { type: 'threshold', limit: 0.1, text: 'límite genérico 0,1 %' }],
  ['Muta. 2', { type: 'threshold', limit: 1, text: 'límite genérico 1 %' }],
  ['Carc. 1', { type: 'threshold', limit: 0.1, text: 'límite genérico 0,1 %' }],
  ['Carc. 2', { type: 'dual', low: 0.1, high: 1, text: 'límite genérico 0,1 % o 1 % según la autoridad' }],
  ['Repr. 1', { type: 'dual', low: 0.1, high: 0.3, text: 'límite genérico 0,1 % o 0,3 % según la autoridad' }],
  ['Repr. 2', { type: 'dual', low: 0.1, high: 3, text: 'límite genérico 0,1 % o 3 % según la autoridad' }],
  ['Lact.', { type: 'dual', low: 0.1, high: 0.3, text: 'límite genérico 0,1 % o 0,3 % según la autoridad' }],
  ['STOT SE 3', { type: 'additive', text: 'regla de adición: suma ≥ 20 %' }],
  ['STOT SE 1', { type: 'threshold', limit: 1, text: 'límite genérico: ≥ 10 % → cat. 1; 1–10 % → cat. 2' }],
  ['STOT RE 1', { type: 'threshold', limit: 1, text: 'límite genérico: ≥ 10 % → cat. 1; 1–10 % → cat. 2' }],
  ['STOT SE 2', { type: 'dual', low: 1, high: 10, text: 'límite genérico 1 % o 10 % según la autoridad' }],
  ['STOT RE 2', { type: 'dual', low: 1, high: 10, text: 'límite genérico 1 % o 10 % según la autoridad' }],
  [
    'Asp. Tox. 1',
    { type: 'threshold', limit: 10, text: 'límite genérico 10 % y viscosidad cinemática ≤ 20,5 mm²/s a 40 °C' },
  ],
  ['Aquatic', { type: 'additive', text: 'sumatoria con factor M: suma (% × M) ≥ 25 % por categoría' }],
  ['Ozone', { type: 'threshold', limit: 0.1, text: 'límite genérico 0,1 %' }],
];
const PHYSICAL_RULE: GenericRule = {
  type: 'physical',
  text: 'no se calcula por concentración: depende de ensayos de la mezcla (p. ej. punto de inflamación y de ebullición)',
};
const PHYSICAL_PREFIXES = [
  'Expl.',
  'Flam.',
  'Aerosol',
  'Ox.',
  'Press. Gas',
  'Self-react.',
  'Pyr.',
  'Self-heat.',
  'Water-react.',
  'Org. Perox.',
  'Met. Corr.',
  'Desen. Expl.',
];

/** Cómo se le explica al agente cada veredicto (bloque <mixture_rules>). */
const VERDICT_TEXT: Record<ContributionVerdict, string> = {
  reaches: 'ALCANZA el límite: el peligro pasa a la mezcla',
  below: 'por debajo del límite: por sí solo no pasa a la mezcla',
  'authority-dependent': 'entre los dos límites: depende del criterio de la autoridad del país',
  additive: 'se suma con los demás componentes',
  'not-by-concentration': 'no depende del %',
};

/** "Carc. 1B" → "Carc." (familia), para casar SCL con la clase aunque la categoría difiera. */
const family = (code: string): string => code.replace(/\s*\d[A-C]?$/i, '').trim();
const parseNumber = (text: string): number => Number(text.replace(',', '.'));
const format = (value: number): string => `${String(value).replace('.', ',')} %`;

/**
 * Qué aporta cada componente de una mezcla según su concentración (función pura). Por cada clase de
 * peligro del componente (ECHA: armonizada y, si no la cubre, la notificada dominante) dice qué límite
 * aplica —el específico de ECHA (SCL) si existe, si no el genérico del SGA— y si el % lo alcanza. El agente
 * lo usa para redactar las secciones 2, 3, 11 y 12 sin deducir límites de memoria; la clasificación
 * final de la mezcla la confirma el cálculo SGA.
 */
export class MixtureConcentrationProfile {
  /**
   * @param options.lowerCutOffs el país aplica el menor de los dos límites genéricos que admite el SGA
   *   (Repr. 2: 0,1 % en vez de 3 %): lo que queda entre ambos ALCANZA el límite en vez de "depende".
   */
  static build(
    components: readonly MixtureComponentInput[],
    current: readonly CurrentSourceData[],
    options: { lowerCutOffs?: boolean } = {},
  ): ComponentConcentrationProfile[] {
    return components.map((component) => {
      const data = current.find((c) => c.cas === component.cas);
      const harmonised = MixtureConcentrationProfile.harmonised(data);
      const notified = MixtureConcentrationProfile.record<NotifiedValue>(data, 'ghs.notified');

      const classes = new Map<string, { statements: string[]; origin: HazardContribution['origin'] }>();
      for (const entry of harmonised?.hazardClasses ?? []) {
        if (entry.code)
          classes.set(entry.code, { statements: MixtureConcentrationProfile.codes(entry), origin: 'harmonised' });
      }
      // La notificada completa lo que la armonizada no cubre (la armonizada suele ser parcial).
      const harmonisedFamilies = new Set([...classes.keys()].map(family));
      for (const entry of notified?.dominant?.hazardClasses ?? []) {
        if (entry.code && !classes.has(entry.code) && !harmonisedFamilies.has(family(entry.code))) {
          classes.set(entry.code, { statements: MixtureConcentrationProfile.codes(entry), origin: 'notified' });
        }
      }

      const scls = (harmonised?.specificConcentrationLimits ?? []).filter(
        (scl) => scl.range && scl.hazardClasses?.length,
      );
      return {
        cas: component.cas,
        name: component.name,
        percentage: component.percentage,
        concentration: component.concentration,
        contributions: [...classes].map(([hazardClass, { statements, origin }]) =>
          MixtureConcentrationProfile.contribution(
            hazardClass,
            statements,
            origin,
            component.percentage,
            scls,
            options.lowerCutOffs ?? false,
          ),
        ),
        mFactors: harmonised?.mFactors ?? undefined,
        acuteToxicityEstimates: (harmonised?.acuteToxicityEstimates ?? [])
          .filter((ate) => ate.value != null)
          .map((ate) => `ETA ${ate.route ?? ''}: ${ate.value} ${ate.unit ?? ''}`.replace(/\s+/g, ' ').trim()),
      };
    });
  }

  /** El bloque <mixture_rules> del prompt. Vacío si no hay nada que decir. */
  static render(profiles: readonly ComponentConcentrationProfile[]): string {
    const blocks = profiles
      .filter((profile) => profile.contributions.length)
      .map((profile) => {
        const lines = profile.contributions.map(
          (c) =>
            `  · ${c.hazardClass}${c.hazardStatements.length ? ` (${c.hazardStatements.join(', ')})` : ''}${c.origin === 'notified' ? ' [notificada]' : ''}: ${c.limit} → ${VERDICT_TEXT[c.verdict]}.`,
        );
        if (profile.mFactors?.acute || profile.mFactors?.chronic) {
          lines.push(
            `  · Factor M: ${[profile.mFactors.acute && `agudo ${profile.mFactors.acute}`, profile.mFactors.chronic && `crónico ${profile.mFactors.chronic}`].filter(Boolean).join(', ')}.`,
          );
        }
        profile.acuteToxicityEstimates.forEach((ate) => lines.push(`  · ${ate}.`));
        return `- ${profile.name ?? 'Sin nombre'} (CAS ${profile.cas}) ${profile.concentration ?? format(profile.percentage)}:\n${lines.join('\n')}`;
      });
    return blocks.join('\n');
  }

  private static contribution(
    hazardClass: string,
    hazardStatements: string[],
    origin: HazardContribution['origin'],
    percentage: number,
    scls: ReadonlyArray<{ range?: string; hazardClasses?: string[] }>,
    lowerCutOffs: boolean,
  ): HazardContribution {
    // Límite específico (SCL) de ECHA para la misma familia de peligro: reemplaza al genérico.
    const specific = scls
      .filter((scl) => scl.hazardClasses!.some((code) => family(code) === family(hazardClass)))
      .map((scl) => ({ scl, bounds: MixtureConcentrationProfile.bounds(scl.range!) }))
      .filter(({ bounds }) => bounds.low !== null);
    if (specific.length) {
      const hit = specific.find(
        ({ bounds }) => percentage >= bounds.low! && (bounds.high === null || percentage < bounds.high),
      );
      const limit = specific.map(({ scl }) => `${scl.hazardClasses!.join('/')}: ${scl.range}`).join('; ');
      return {
        hazardClass,
        hazardStatements,
        origin,
        limit: `límite específico (ECHA) ${limit}`,
        limitKind: 'specific',
        verdict: hit ? 'reaches' : 'below',
      };
    }

    const rule = MixtureConcentrationProfile.rule(hazardClass);
    const verdict = MixtureConcentrationProfile.verdict(rule, percentage, lowerCutOffs);
    return {
      hazardClass,
      hazardStatements,
      origin,
      limit:
        rule.type === 'dual' && lowerCutOffs
          ? `${rule.text} (el país aplica el menor: ${format(rule.low)})`
          : rule.text,
      limitKind: rule.type === 'threshold' || rule.type === 'dual' ? 'generic' : 'rule',
      verdict,
    };
  }

  /** Si el % del componente alcanza el límite genérico de la regla. */
  private static verdict(rule: GenericRule, percentage: number, lowerCutOffs: boolean): ContributionVerdict {
    switch (rule.type) {
      case 'physical':
        return 'not-by-concentration';
      case 'additive':
        return 'additive';
      case 'threshold':
        return percentage >= rule.limit ? 'reaches' : 'below';
      case 'dual':
        if (percentage >= rule.high) return 'reaches';
        if (percentage < rule.low) return 'below';
        // Entre los dos límites: alcanza si el país aplica el menor; si no, depende de la autoridad.
        return lowerCutOffs ? 'reaches' : 'authority-dependent';
    }
  }

  private static rule(hazardClass: string): GenericRule {
    if (PHYSICAL_PREFIXES.some((prefix) => hazardClass.startsWith(prefix))) return PHYSICAL_RULE;
    const match = GENERIC_RULES.find(([prefix]) => hazardClass.startsWith(prefix));
    return match?.[1] ?? { type: 'additive', text: 'sin límite genérico tabulado: revisar con el SGA' };
  }

  /** "C ≥ 1 %", ">= 50", "0,1 % ≤ C < 1 %" → límites inferior y superior (%). */
  static bounds(range: string): { low: number | null; high: number | null } {
    const normalized = range.replace(/>=/g, '≥').replace(/<=/g, '≤');
    const between = /([\d.,]+)\s*%?\s*≤\s*C\s*<\s*([\d.,]+)/.exec(normalized);
    if (between) return { low: parseNumber(between[1]), high: parseNumber(between[2]) };
    const low = /(?:C\s*)?[≥>]\s*([\d.,]+)/.exec(normalized);
    const high = /C\s*<\s*([\d.,]+)/.exec(normalized);
    return { low: low ? parseNumber(low[1]) : null, high: high ? parseNumber(high[1]) : null };
  }

  private static codes(entry: HazardClassEntry): string[] {
    return [...new Set((entry.hazardStatements ?? []).map((h) => h.code).filter((c): c is string => Boolean(c)))];
  }

  /** La entrada armonizada vigente (la primera: el proveedor ya las ordena vigentes primero). */
  private static harmonised(data: CurrentSourceData | undefined): HarmonisedEntry | undefined {
    const value = MixtureConcentrationProfile.record<HarmonisedEntry[]>(data, 'ghs.harmonised');
    return Array.isArray(value) ? value[0] : undefined;
  }

  private static record<T>(data: CurrentSourceData | undefined, field: string): T | undefined {
    return data?.sources
      .find((source) => source.source === 'ECHA' && source.status === 'OK')
      ?.records.find((record) => record.field === field)?.value as T | undefined;
  }
}

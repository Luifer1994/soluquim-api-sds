import { SdsCitationDTO, SdsFieldProposalDTO, SdsSourceEvidenceDTO } from '@/modules/sds/sdsdocument/dto/response';

/** Campos de la etiqueta (sección 2.2) que se pueden rearmar desde las fuentes ya guardadas. */
const LABEL_FIELDS = new Set([
  'pictograms',
  'signalWord',
  'hazardStatements',
  'precautionaryStatements',
  'supplementalHazard',
]);

const PICTOGRAM = /^GHS0[1-9]$/;
const HAZARD = /^H\d{3}[A-Z]*(?:\+H\d{3}[A-Z]*)*$/;
const PRECAUTION = /^P\d{3}(?:\+P\d{3})*$/;
const SUPPLEMENTAL = /^EUH\d{3}$/;
const SIGNAL: Record<string, string> = {
  danger: 'Peligro',
  peligro: 'Peligro',
  warning: 'Atención',
  atencion: 'Atención',
  atención: 'Atención',
};

/**
 * Reconstruye un campo de la etiqueta con los códigos que ya trajeron las fuentes de la sección.
 * Sirve cuando el revisor borró el dato y la sugerencia original no quedó guardada.
 */
export class SdsLabelProposal {
  static fromEvidence(key: string, evidence: SdsSourceEvidenceDTO[], language: string): SdsFieldProposalDTO | null {
    if (!LABEL_FIELDS.has(key)) return null;
    const value = SdsLabelProposal.value(key, evidence, language);
    if (!value) return null;
    return { value, origin: 'source', citations: SdsLabelProposal.citations(evidence) };
  }

  private static value(key: string, evidence: SdsSourceEvidenceDTO[], language: string): string | null {
    if (key === 'pictograms') return join(SdsLabelProposal.codes(evidence, PICTOGRAM));
    if (key === 'hazardStatements') return join(SdsLabelProposal.codes(evidence, HAZARD));
    if (key === 'precautionaryStatements') return join(SdsLabelProposal.codes(evidence, PRECAUTION));
    if (key === 'supplementalHazard') return join(SdsLabelProposal.codes(evidence, SUPPLEMENTAL));
    if (key === 'signalWord') return SdsLabelProposal.signal(evidence, language);
    return null;
  }

  /** Códigos que aparecen en los registros, sin repetir. En una mezcla, los de todos los componentes. */
  private static codes(evidence: SdsSourceEvidenceDTO[], pattern: RegExp): string[] {
    const found = new Set<string>();
    for (const item of evidence) {
      for (const record of item.records) collect(record.value, pattern, found);
    }
    return [...found].sort();
  }

  private static signal(evidence: SdsSourceEvidenceDTO[], language: string): string | null {
    const words = new Set<string>();
    for (const item of evidence) {
      for (const record of item.records) collectSignal(record.value, words);
    }
    const word = words.has('Peligro') ? 'Peligro' : words.has('Atención') ? 'Atención' : null;
    if (!word) return null;
    if (language === 'en') return word === 'Peligro' ? 'Danger' : 'Warning';
    if (language === 'pt') return word === 'Peligro' ? 'Perigo' : 'Atenção';
    return word;
  }

  private static citations(evidence: SdsSourceEvidenceDTO[]): SdsCitationDTO[] {
    const seen = new Set<string>();
    const citations: SdsCitationDTO[] = [];
    for (const item of evidence) {
      const ref = `${item.source}:${item.cas}`;
      if (seen.has(ref)) continue;
      seen.add(ref);
      citations.push({
        ref,
        source: item.source,
        cas: item.cas,
        title: [item.source, item.componentName ?? item.cas].join(' · '),
        sourceUrl: item.sourceUrl ?? null,
      });
    }
    return citations;
  }
}

function join(codes: string[]): string | null {
  return codes.length ? codes.join(', ') : null;
}

function collect(value: unknown, pattern: RegExp, found: Set<string>): void {
  if (typeof value === 'string') {
    for (const token of value.split(/[,;\n]/)) {
      const text = token.trim().toUpperCase();
      if (pattern.test(text)) found.add(text);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collect(item, pattern, found));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const code = (value as { code?: unknown }).code;
  if (typeof code === 'string') collect(code, pattern, found);
  Object.values(value as Record<string, unknown>).forEach((item) => collect(item, pattern, found));
}

function collectSignal(value: unknown, found: Set<string>): void {
  if (typeof value === 'string') {
    const word = SIGNAL[value.trim().toLowerCase()];
    if (word) found.add(word);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSignal(item, found));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const signal = (value as { signalWord?: unknown }).signalWord;
  if (typeof signal === 'string') collectSignal(signal, found);
  Object.values(value as Record<string, unknown>).forEach((item) => collectSignal(item, found));
}

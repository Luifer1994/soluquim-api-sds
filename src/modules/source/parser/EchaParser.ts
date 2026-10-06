// ─── Respuestas de la API de ECHA CHEM (solo lo que usamos) ─────────────────

interface Items<T> {
  items?: T[];
}

export interface EchaSubstanceIndex {
  rmlId: string;
  rmlName?: string;
  rmlCas?: string;
  rmlEc?: string;
  rmlIupac?: string;
  rmlMolFormula?: string;
  casNumber?: string[];
  indexNumber?: string[];
  regulatoryProcesses?: string[];
}

export type EchaSearchResponse = Items<{ substanceIndex: EchaSubstanceIndex }>;

export type EchaClassificationListResponse = Items<{
  classificationId: string;
  indexNumber?: string;
  chemicalName?: string;
  atpCodeName?: string;
  effectiveDate?: string;
  status?: string;
  dataSource?: string;
  eurLexLink?: string;
  isInheritedFlag?: boolean;
  substanceNotificationPercentage?: number;
}>;

export type EchaClassificationResponse = Items<{
  hazardClassAndCategoryCode: string;
  hazardStatements?: Array<{ hazardStatementCode: string; hazardStatementText?: string }>;
}>;

export type EchaLabellingResponse = Items<{
  signalWord?: { signalWordCode?: string; signalWordText?: string };
  hazardStatement?: { hazardStatementCode: string; hazardStatementText?: string };
}>;

export type EchaPictogramsResponse = Items<{ code: string; text?: string }>;

export type EchaScl = Items<{
  concentrationRange: string;
  hazards?: Array<{ hazardClassAndCategoryCode: string; hazardStatementCode?: string }>;
}>;

export interface EchaMFactors {
  mfactorAcute?: number | null;
  mfactorChronic?: number | null;
}

export type EchaAteResponse = Items<{
  routeExposure?: { routeOfExposure?: string };
  acuteToxicity?: { estimation?: number; unit?: string; unitTestAtmosphere?: string };
}>;

export type EchaNotesResponse = Items<{ note?: { noteCode?: string; noteText?: string } }>;

/** Todas las piezas de UNA clasificación armonizada (Anexo VI del CLP). */
export interface EchaHarmonisedParts {
  entry: NonNullable<EchaClassificationListResponse['items']>[number];
  classification: EchaClassificationResponse;
  labelling: EchaLabellingResponse;
  pictograms: EchaPictogramsResponse;
  specificConcentrationLimits: EchaScl;
  mFactors: EchaMFactors | null;
  acuteToxicityEstimates: EchaAteResponse;
  notes: EchaNotesResponse;
}

// ─── Resultado normalizado ───────────────────────────────────────────────────

export interface EchaHazardClass {
  /** "Flam. Liq. 2", "Carc. 1B", "Acute Tox. 3 (Oral)"… */
  code: string;
  hazardStatements: Array<{ code: string; text?: string }>;
}

export interface EchaHarmonisedClassification {
  indexNumber?: string;
  chemicalName?: string;
  /** Adaptación al progreso técnico que la fijó (p. ej. ATP22) y desde cuándo aplica. */
  atp?: string;
  effectiveDate?: string;
  status?: string;
  legalReference?: string;
  hazardClasses: EchaHazardClass[];
  signalWord?: string;
  labellingStatements: Array<{ code: string; text?: string }>;
  pictograms: Array<{ code: string; name?: string }>;
  /** Límites de concentración específicos (SCL): reemplazan a los genéricos al clasificar la mezcla. */
  specificConcentrationLimits: Array<{ range: string; hazardClasses: string[] }>;
  /** Factores M (peligro acuático): multiplican el % del componente en la sumatoria de la mezcla. */
  mFactors: { acute?: number; chronic?: number } | null;
  /** Estimaciones de toxicidad aguda (ETA) para la fórmula de la mezcla. */
  acuteToxicityEstimates: Array<{ route?: string; value?: number; unit?: string; atmosphere?: string }>;
  notes: Array<{ code?: string; text?: string }>;
}

export const ECHA_BASE_URL = 'https://chem.echa.europa.eu';
/** Los términos de ECHA exigen esta cita en toda reproducción de sus datos. */
export const ECHA_ATTRIBUTION = 'Source: European Chemicals Agency, https://echa.europa.eu/';

const stripTags = (text?: string): string | undefined => text?.replace(/\s+/g, ' ').trim() || undefined;

/** Parser PURO de las respuestas JSON de ECHA CHEM (sin red): se prueba con fixtures reales. */
export class EchaParser {
  static substanceUrl(rmlId: string): string {
    return `${ECHA_BASE_URL}/${rmlId}`;
  }

  /** La búsqueda es aproximada (50-00-0 trae también 5850-00-0): solo vale la coincidencia EXACTA del CAS. */
  static pickSubstance(response: EchaSearchResponse, cas: string): EchaSubstanceIndex | undefined {
    const substances = (response.items ?? []).map((item) => item.substanceIndex);
    return substances.find((s) => s.rmlCas === cas) ?? substances.find((s) => s.casNumber?.includes(cas));
  }

  /** Entradas armonizadas vigentes primero (no heredadas, "In application"). */
  static sortHarmonised(list: EchaClassificationListResponse): NonNullable<EchaClassificationListResponse['items']> {
    const score = (e: { status?: string; isInheritedFlag?: boolean }) =>
      (e.status === 'In application' ? 0 : 2) + (e.isInheritedFlag ? 1 : 0);
    return [...(list.items ?? [])].sort((a, b) => score(a) - score(b));
  }

  static parseHarmonised(parts: EchaHarmonisedParts): EchaHarmonisedClassification {
    const labelling = parts.labelling.items ?? [];
    const mFactors = parts.mFactors;
    const hasMFactors = mFactors && (mFactors.mfactorAcute != null || mFactors.mfactorChronic != null);

    return {
      indexNumber: parts.entry.indexNumber,
      chemicalName: parts.entry.chemicalName,
      atp: parts.entry.atpCodeName,
      effectiveDate: parts.entry.effectiveDate,
      status: parts.entry.status,
      legalReference: parts.entry.eurLexLink,
      hazardClasses: EchaParser.parseHazardClasses(parts.classification),
      signalWord: labelling.find((l) => l.signalWord?.signalWordText)?.signalWord?.signalWordText,
      labellingStatements: labelling
        .filter((l) => l.hazardStatement?.hazardStatementCode)
        .map((l) => ({
          code: l.hazardStatement!.hazardStatementCode,
          text: stripTags(l.hazardStatement!.hazardStatementText),
        })),
      pictograms: EchaParser.parsePictograms(parts.pictograms),
      specificConcentrationLimits: (parts.specificConcentrationLimits.items ?? []).map((scl) => ({
        range: scl.concentrationRange,
        // Algunas filas (rango "*", límite mínimo) no traen código de clase: se descartan esos huecos.
        hazardClasses: (scl.hazards ?? [])
          .map((h) => h.hazardClassAndCategoryCode)
          .filter((code): code is string => Boolean(code)),
      })),
      mFactors: hasMFactors
        ? { acute: mFactors.mfactorAcute ?? undefined, chronic: mFactors.mfactorChronic ?? undefined }
        : null,
      acuteToxicityEstimates: (parts.acuteToxicityEstimates.items ?? []).map((ate) => ({
        route: ate.routeExposure?.routeOfExposure,
        value: ate.acuteToxicity?.estimation,
        unit: ate.acuteToxicity?.unit,
        atmosphere: ate.acuteToxicity?.unitTestAtmosphere || undefined,
      })),
      notes: (parts.notes.items ?? []).map((n) => ({ code: n.note?.noteCode, text: stripTags(n.note?.noteText) })),
    };
  }

  static parseHazardClasses(response: EchaClassificationResponse): EchaHazardClass[] {
    return (response.items ?? []).map((item) => ({
      code: item.hazardClassAndCategoryCode,
      hazardStatements: (item.hazardStatements ?? []).map((h) => ({
        code: h.hazardStatementCode,
        text: stripTags(h.hazardStatementText),
      })),
    }));
  }

  static parsePictograms(response: EchaPictogramsResponse): Array<{ code: string; name?: string }> {
    const seen = new Set<string>();
    return (response.items ?? [])
      .filter((p) => !seen.has(p.code) && seen.add(p.code))
      .map((p) => ({ code: p.code, name: p.text }));
  }

  /** Notificaciones de la industria ordenadas por % de notificantes (la dominante primero). */
  static sortNotified(list: EchaClassificationListResponse): NonNullable<EchaClassificationListResponse['items']> {
    return [...(list.items ?? [])].sort(
      (a, b) => (b.substanceNotificationPercentage ?? 0) - (a.substanceNotificationPercentage ?? 0),
    );
  }

  /** Las m-factors armonizadas responden 200 con cuerpo VACÍO cuando no hay. */
  static parseMFactors(raw: string): EchaMFactors | null {
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw) as EchaMFactors & { items?: EchaMFactors[] };
    return parsed.items ? (parsed.items[0] ?? null) : parsed;
  }
}

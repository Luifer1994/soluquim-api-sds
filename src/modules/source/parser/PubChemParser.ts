import { SourceRecord } from '@/modules/source/dto';

// ─── Tipos mínimos de las respuestas de PubChem que usamos ───────────────────

export interface PubChemPropertiesResponse {
  PropertyTable?: {
    Properties?: Array<{
      CID: number;
      Title?: string;
      IUPACName?: string;
      MolecularFormula?: string;
      MolecularWeight?: string | number;
      InChIKey?: string;
      SMILES?: string;
    }>;
  };
}

export interface PubChemSynonymsResponse {
  InformationList?: { Information?: Array<{ CID: number; Synonym?: string[] }> };
}

interface PugViewMarkup {
  Type?: string;
  URL?: string;
  Extra?: string;
}

interface PugViewInformation {
  ReferenceNumber?: number;
  Name?: string;
  Value?: { StringWithMarkup?: Array<{ String?: string; Markup?: PugViewMarkup[] }> };
}

interface PugViewSection {
  TOCHeading?: string;
  Information?: PugViewInformation[];
  Section?: PugViewSection[];
}

export interface PubChemGhsResponse {
  Record?: {
    Section?: PugViewSection[];
    Reference?: Array<{ ReferenceNumber: number; SourceName?: string; Name?: string; URL?: string }>;
  };
}

// ─── Resultado normalizado ───────────────────────────────────────────────────

export interface GhsStatement {
  code: string;
  text: string;
  /** % de notificaciones que reportan la frase (solo en clasificaciones agregadas de ECHA). */
  reportedPercentage?: number;
}

export interface GhsClassification {
  /** Quién clasifica: "Regulation (EC) No 1272/2008…" (armonizada) o "European Chemicals Agency (ECHA)" (notificaciones). */
  sourceName: string;
  sourceDetail?: string;
  sourceUrl?: string;
  /** Clasificación armonizada del Anexo VI del CLP: obligatoria en la UE y la de mayor peso. */
  harmonized: boolean;
  pictograms: Array<{ code: string; name: string }>;
  signalWord?: string;
  hazardStatements: GhsStatement[];
  precautionaryStatements: string[];
  notes: string[];
}

const HARMONIZED_SOURCE = 'Regulation (EC) No 1272/2008';

/** Parser PURO de las respuestas JSON de PubChem (sin red): se prueba con fixtures reales. */
export class PubChemParser {
  /** Página pública del compuesto en PubChem. */
  static compoundUrl(cid: number): string {
    return `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`;
  }

  /** El CAS figura entre los sinónimos del compuesto: confirma que el CID corresponde a ese CAS. */
  static isCasInSynonyms(response: PubChemSynonymsResponse, cas: string): boolean {
    return (response.InformationList?.Information?.[0]?.Synonym ?? []).includes(cas);
  }

  static parseIdentity(
    properties: PubChemPropertiesResponse,
    synonyms: PubChemSynonymsResponse,
    cas: string,
    sourceUrl: string,
  ): SourceRecord[] {
    const p = properties.PropertyTable?.Properties?.[0];
    if (!p) return [];

    const allSynonyms = synonyms.InformationList?.Information?.[0]?.Synonym ?? [];
    // Los sinónimos que son códigos (otros CAS, EINECS, UNII…) no aportan como nombres.
    const names = allSynonyms.filter((s) => !/^[\d-]+$/.test(s) && !/^[A-Z0-9]{10}$/.test(s)).slice(0, 15);

    const records: SourceRecord[] = [
      { field: 'identity.pubchemCid', label: 'PubChem CID', value: p.CID, sourceUrl },
      { field: 'identity.name', label: 'Title', value: p.Title, sourceUrl },
      { field: 'identity.iupacName', label: 'IUPAC Name', value: p.IUPACName, sourceUrl },
      { field: 'identity.molecularFormula', label: 'Molecular Formula', value: p.MolecularFormula, sourceUrl },
      {
        field: 'identity.molecularWeight',
        label: 'Molecular Weight',
        value: p.MolecularWeight === undefined ? undefined : Number(p.MolecularWeight),
        unit: 'g/mol',
        sourceUrl,
      },
      { field: 'identity.inchiKey', label: 'InChIKey', value: p.InChIKey, sourceUrl },
      { field: 'identity.smiles', label: 'SMILES', value: p.SMILES, sourceUrl },
      { field: 'identity.synonyms', label: 'Synonyms', value: names, sourceUrl },
      {
        field: 'identity.casVerified',
        label: 'CAS presente en los sinónimos de PubChem',
        value: allSynonyms.includes(cas),
        sourceUrl,
      },
    ];
    return records.filter((record) => record.value !== undefined && record.value !== '');
  }

  /**
   * PUG-View agrupa la información SGA por `ReferenceNumber`: cada referencia es una clasificación
   * distinta (la armonizada del CLP, las agregadas de notificaciones a ECHA, etc.). Se devuelven todas,
   * con la armonizada primero, para poder detectar conflictos más adelante.
   */
  static parseGhsClassifications(response: PubChemGhsResponse): GhsClassification[] {
    const section = findSection(response.Record?.Section ?? [], 'GHS Classification');
    if (!section?.Information?.length) return [];

    const references = new Map((response.Record?.Reference ?? []).map((ref) => [ref.ReferenceNumber, ref]));
    const byReference = new Map<number, GhsClassification>();

    for (const info of section.Information) {
      const refNumber = info.ReferenceNumber ?? -1;
      const reference = references.get(refNumber);
      const sourceName = reference?.SourceName ?? 'Desconocida';

      let classification = byReference.get(refNumber);
      if (!classification) {
        classification = {
          sourceName,
          sourceDetail: reference?.Name,
          sourceUrl: reference?.URL,
          harmonized: sourceName.startsWith(HARMONIZED_SOURCE),
          pictograms: [],
          hazardStatements: [],
          precautionaryStatements: [],
          notes: [],
        };
        byReference.set(refNumber, classification);
      }

      const strings = info.Value?.StringWithMarkup ?? [];
      const texts = strings.map((s) => s.String?.trim() ?? '').filter(Boolean);

      switch (info.Name) {
        case 'Pictogram(s)':
          for (const markup of strings.flatMap((s) => s.Markup ?? [])) {
            const code = /\/(GHS\d{2})\.svg$/i.exec(markup.URL ?? '')?.[1];
            if (markup.Type === 'Icon' && code && !classification.pictograms.some((p) => p.code === code)) {
              classification.pictograms.push({ code: code.toUpperCase(), name: markup.Extra ?? code });
            }
          }
          break;
        case 'Signal':
          classification.signalWord = texts[0];
          break;
        case 'GHS Hazard Statements':
          classification.hazardStatements.push(...texts.map(parseHazardStatement).filter((s) => s !== null));
          break;
        case 'Precautionary Statement Codes':
          classification.precautionaryStatements.push(...texts.flatMap(parsePrecautionaryCodes));
          break;
        default:
          classification.notes.push(...texts);
      }
    }

    return [...byReference.values()]
      .filter(
        (c) => c.pictograms.length || c.signalWord || c.hazardStatements.length || c.precautionaryStatements.length,
      )
      .sort((a, b) => Number(b.harmonized) - Number(a.harmonized));
  }
}

function findSection(sections: PugViewSection[], heading: string): PugViewSection | undefined {
  for (const section of sections) {
    if (section.TOCHeading === heading) return section;
    const nested = findSection(section.Section ?? [], heading);
    if (nested) return nested;
  }
  return undefined;
}

/** "H319 (37.7%): Causes serious eye irritation [Warning …]" → { code, text, reportedPercentage } */
function parseHazardStatement(text: string): GhsStatement | null {
  const match = /^(EUH\d{3}|H\d{3}[A-Za-z]*(?:\+H\d{3}[A-Za-z]*)*)\s*(?:\(([\d.]+)%\))?\s*:?\s*(.*)$/.exec(text);
  if (!match) return null;
  const statement: GhsStatement = { code: match[1], text: match[3].replace(/\s*\[[^\]]*\]\s*$/, '').trim() };
  if (match[2]) statement.reportedPercentage = Number(match[2]);
  return statement;
}

/** "P210, P233, P303+P361+P353, and P501 (click each P-code…)" → ['P210', 'P233', 'P303+P361+P353', 'P501'] */
function parsePrecautionaryCodes(text: string): string[] {
  return text.match(/P\d{3}(?:\+P\d{3})*/g) ?? [];
}

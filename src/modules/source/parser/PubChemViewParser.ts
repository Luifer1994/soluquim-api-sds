import { SourceRecord } from '@/modules/source/dto';

interface ViewMarkupString {
  String?: string;
}
interface ViewInformation {
  ReferenceNumber?: number;
  Name?: string;
  Value?: { StringWithMarkup?: ViewMarkupString[]; Number?: number[]; Unit?: string };
}
interface ViewSection {
  TOCHeading?: string;
  Information?: ViewInformation[];
  Section?: ViewSection[];
}
export interface PubChemViewResponse {
  Record?: {
    Section?: ViewSection[];
    Reference?: Array<{ ReferenceNumber?: number; SourceName?: string }>;
  };
}

/** Bloques del registro completo de PubChem que se piden (uno por request). */
export const PUBCHEM_VIEW_HEADINGS = ['Chemical and Physical Properties', 'Safety and Hazards', 'Toxicity'] as const;

/** Máximo de datos que se guardan por apartado, y largo máximo de cada uno. */
const MAX_ITEMS = 5;
const MAX_ITEM_CHARS = 700;

/**
 * Colecciones que ya se consultan directamente como fuente propia: sus datos no se repiten vía PubChem.
 */
const SKIPPED_SOURCES = [/International Chemical Safety Cards/i, /NIOSH/i];

/**
 * Apartado de PubChem (TOCHeading) → campo normalizado. Solo apartados con contenido de FDS; lo demás
 * del registro (farmacología, patentes, literatura…) se ignora. El prefijo del campo decide a qué
 * secciones de la FDS alimenta (ver SdsSectionCatalog).
 */
const HEADING_FIELDS: Record<string, string> = {
  // Propiedades físicas y químicas (sección 9)
  'Physical Description': 'physical.description',
  'Color/Form': 'physical.color',
  Odor: 'physical.odor',
  'Odor Threshold': 'physical.odorThreshold',
  'Boiling Point': 'physical.boilingPoint',
  'Melting Point': 'physical.meltingPoint',
  'Flash Point': 'physical.flashPoint',
  Solubility: 'physical.solubility',
  Density: 'physical.density',
  'Vapor Density': 'physical.relativeVaporDensity',
  'Vapor Pressure': 'physical.vaporPressure',
  LogP: 'physical.logPow',
  'Autoignition Temperature': 'physical.autoIgnitionTemperature',
  Viscosity: 'physical.viscosity',
  pH: 'physical.pH',
  'Flammable Limits': 'physical.explosiveLimits',
  Decomposition: 'reactivity.decomposition',
  Corrosivity: 'reactivity.corrosivity',
  'Stability/Shelf Life': 'reactivity.stability',
  // Peligros, primeros auxilios, incendio, vertidos (secciones 2, 4, 5, 6)
  'Hazards Summary': 'hazard.summary',
  'Health Hazards': 'health.hazards',
  'Skin, Eye, and Respiratory Irritations': 'health.irritation',
  'First Aid': 'firstAid.measures',
  'Antidote and Emergency Treatment': 'firstAid.medicalTreatment',
  'Fire Hazards': 'fire.hazards',
  'Fire Fighting': 'fire.extinguishing',
  'Fire Fighting Procedures': 'fire.procedures',
  'Toxic Combustion Products': 'fire.combustionProducts',
  'Hazardous Decomposition Products': 'reactivity.decompositionProducts',
  'Isolation and Evacuation': 'spill.isolation',
  'Spillage Disposal': 'spill.measures',
  'Cleanup Methods': 'spill.cleanup',
  'Disposal Methods': 'disposal.methods',
  // Manipulación, almacenamiento y exposición (secciones 7 y 8)
  'Preventive Measures': 'storage.handling',
  'Safe Storage': 'storage.safeStorage',
  'Storage Conditions': 'storage.conditions',
  'Recommended Exposure Limit (REL)': 'exposure.rel',
  'Permissible Exposure Limit (PEL)': 'exposure.pel',
  'Threshold Limit Values (TLV)': 'exposure.tlv',
  'Occupational Exposure Limits (OEL)': 'exposure.oel',
  'Immediately Dangerous to Life or Health (IDLH)': 'exposure.idlh',
  'Personal Protective Equipment (PPE)': 'protection.personal',
  'Respirator Recommendations': 'protection.respirator',
  // Estabilidad y reactividad (sección 10)
  'Air and Water Reactions': 'reactivity.airWater',
  'Reactivity Profile': 'reactivity.profile',
  'Hazardous Reactivities and Incompatibilities': 'reactivity.incompatibilities',
  // Toxicología (sección 11)
  'Toxicity Summary': 'toxicology.summary',
  'Non-Human Toxicity Values': 'toxicology.nonHumanValues',
  'Human Toxicity Values': 'toxicology.humanValues',
  'Evidence for Carcinogenicity': 'carcinogenicity.evidence',
  'Carcinogen Classification': 'carcinogenicity.classification',
  'Exposure Routes': 'health.exposureRoutes',
  'Signs and Symptoms': 'health.symptoms',
  'Target Organs': 'health.targetOrgans',
  'Acute Effects': 'health.acuteEffects',
  // Ecología (sección 12)
  'Ecotoxicity Values': 'ecology.ecotoxicity',
  'Ecotoxicity Excerpts': 'ecology.ecotoxicityExcerpts',
  'Environmental Fate/Exposure Summary': 'ecology.fateSummary',
  'Environmental Biodegradation': 'ecology.biodegradation',
  'Environmental Abiotic Degradation': 'ecology.abioticDegradation',
  'Environmental Bioconcentration': 'ecology.bioconcentration',
  'Soil Adsorption/Mobility': 'ecology.soilMobility',
  // Transporte (sección 14)
  'Shipping Name/ Number DOT/UN/NA/IMO': 'transport.shippingName',
  'DOT ID and Guide': 'transport.dotId',
  'DOT Label': 'transport.label',
  'UN Classification': 'transport.unClassification',
  'Shipment Methods and Regulations': 'transport.regulations',
};

/**
 * Parser PURO del registro completo de PubChem (PUG-View): PubChem agrega, apartado por apartado, lo
 * que publican HSDB, CAMEO Chemicals, Haz-Map, EPA, etc. Cada dato se guarda con la colección de donde
 * viene ("… [HSDB]"), porque esa es la cita que debe quedar en la FDS.
 */
export class PubChemViewParser {
  static parse(responses: PubChemViewResponse[], compoundUrl: string): SourceRecord[] {
    const byField = new Map<string, SourceRecord>();
    for (const response of responses) {
      const references = new Map(
        (response.Record?.Reference ?? []).map((ref) => [ref.ReferenceNumber, ref.SourceName ?? '']),
      );
      PubChemViewParser.walk(response.Record?.Section ?? [], (section) => {
        const heading = section.TOCHeading ?? '';
        const field = HEADING_FIELDS[heading];
        if (!field || !section.Information?.length) return;
        const items = PubChemViewParser.items(section.Information, references);
        if (!items.length) return;
        const known = byField.get(field);
        byField.set(field, {
          field,
          label: known ? `${known.label} / ${heading}` : heading,
          value: [...((known?.value as string[] | undefined) ?? []), ...items].slice(0, MAX_ITEMS),
          sourceUrl: `${compoundUrl}#section=${encodeURIComponent(heading.replace(/\s+/g, '-'))}`,
        });
      });
    }
    return [...byField.values()];
  }

  /** Los datos de un apartado: texto + colección de origen, sin repetidos y repartidos entre colecciones. */
  private static items(information: ViewInformation[], references: Map<number | undefined, string>): string[] {
    const seen = new Set<string>();
    const bySource = new Map<string, string[]>();
    for (const info of information) {
      const source = references.get(info.ReferenceNumber) ?? '';
      if (SKIPPED_SOURCES.some((pattern) => pattern.test(source))) continue;
      const text = PubChemViewParser.text(info);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      const short = source.match(/\(([^)]+)\)\s*$/)?.[1] ?? source;
      bySource.set(short, [...(bySource.get(short) ?? []), short ? `${text} [${short}]` : text]);
    }
    // Un dato de cada colección por turno: así no se llenan los cupos con una sola fuente.
    const queues = [...bySource.values()];
    const picked: string[] = [];
    for (let round = 0; picked.length < MAX_ITEMS && queues.some((queue) => queue[round]); round++) {
      for (const queue of queues) if (queue[round] && picked.length < MAX_ITEMS) picked.push(queue[round]);
    }
    return picked;
  }

  private static text(info: ViewInformation): string | null {
    const strings = (info.Value?.StringWithMarkup ?? []).map((part) => part.String?.trim()).filter(Boolean);
    const numbers = info.Value?.Number?.length
      ? [`${info.Value.Number.join(' – ')}${info.Value.Unit ? ` ${info.Value.Unit}` : ''}`]
      : [];
    const body = [...strings, ...numbers].join('; ').replace(/\s+/g, ' ').trim();
    if (!body) return null;
    const text = info.Name && !body.startsWith(info.Name) ? `${info.Name}: ${body}` : body;
    return text.length > MAX_ITEM_CHARS ? `${text.slice(0, MAX_ITEM_CHARS)}…` : text;
  }

  private static walk(sections: ViewSection[], visit: (section: ViewSection) => void): void {
    for (const section of sections) {
      visit(section);
      PubChemViewParser.walk(section.Section ?? [], visit);
    }
  }
}

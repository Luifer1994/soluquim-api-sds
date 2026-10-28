import { GhsPictogram, GhsStatement, SdsFieldKind } from '@/modules/knowledge';
import { SourceRecord } from '@/modules/source';

export interface SdsCitationDTO {
  ref: string;
  source: string;
  cas: string | null;
  title: string;
  sourceUrl: string | null;
}

/** Lo que una fuente aporta a una sección, tal cual (sin IA): el usuario puede usarlo en vez de la sugerencia. */
export interface SdsSourceEvidenceDTO {
  cas: string;
  componentName: string | null;
  source: string;
  sourceVersion: number;
  sourceUrl?: string;
  records: SourceRecord[];
}

/** Texto propuesto antes de que el revisor lo cambie. No se pisa al editar: sirve para volver a la sugerencia. */
export interface SdsFieldProposalDTO {
  value: string;
  origin: 'request' | 'system' | 'agent' | 'source';
  citations: SdsCitationDTO[];
}

export interface SdsFieldDTO {
  key: string;
  label: string;
  /** null = sin datos disponibles (ninguna fuente lo trae o no vino en la solicitud). */
  value: string | null;
  /**
   * Sugerencia original (IA o dato de una fuente). Se conserva aunque el revisor escriba otra cosa.
   * En fichas ya editadas, si no quedó guardada, se reconstruye con las fuentes de la sección.
   */
  proposed?: SdsFieldProposalDTO;
  /**
   * De dónde salió: `request` (vino en la solicitud), `system`, `agent` (IA, con citas), `user` (lo escribió
   * el revisor), `source` (el revisor lo tomó de una fuente, que queda en `citations`) o null si está vacío.
   */
  origin: 'request' | 'system' | 'agent' | 'user' | 'source' | null;
  /** Solo si el revisor cambió el campo. */
  editedAt?: string;
  editedBy?: string | null;
  citations: SdsCitationDTO[];
  /** Cómo está estructurado el valor: texto, pictogramas, frases H/P o palabra de advertencia. */
  kind: SdsFieldKind;
  /** `kind: pictograms` — cada pictograma con su código y nombre (la imagen la resuelve el front por código). */
  pictograms?: GhsPictogram[];
  /** `kind: statements` — cada frase con su código y su texto. */
  statements?: GhsStatement[];
}

export interface SdsSubsectionDTO {
  code: string;
  title: string;
  fields: SdsFieldDTO[];
}

export interface SdsSectionSuggestionDTO {
  subsections: SdsSubsectionDTO[];
  /** La sección como texto, armada desde los campos (los vacíos como "Sin datos disponibles"). */
  content: string;
  /** Etiquetas de los campos que quedaron vacíos. */
  missingData: string[];
  conflicts: Array<{ field: string; chosen: string; alternatives: string[]; reason: string }>;
  confidence: 'high' | 'medium' | 'low' | null;
  /** Referencias que el modelo citó pero NO existían en el contexto. */
  invalidRefs: string[];
  /** Valores que el modelo escribió sin ninguna cita válida: se quitaron de la FDS y quedan aquí para el revisor. */
  discarded: Array<{ key: string; label: string; value: string }>;
}

export interface SdsSectionDTO {
  number: number;
  title: string;
  /** Quién llenó la sección: la solicitud del usuario, el sistema, el agente o directamente las fuentes. */
  filledBy: 'request' | 'system' | 'agent' | 'sources';
  /** Contenido propuesto (null si el agente falló en ese grupo). */
  suggestion: SdsSectionSuggestionDTO | null;
  /** Lo que encontró cada fuente para esta sección, por componente. */
  bySource: SdsSourceEvidenceDTO[];
}

export interface SdsDocumentContentDTO {
  generatedAt: string;
  language: string;
  destinationCountry?: string;
  /** Nombre y CAS del producto, tal como vinieron en la solicitud. */
  product: { name: string | null; cas: string | null };
  /** `percentage`: el máximo posible (para cálculos); `concentration`: como la declaró el usuario ("≤ 99 %"). */
  components: Array<{ cas: string; name: string | null; percentage: number; concentration?: string }>;
  isMixture: boolean;
  sections: SdsSectionDTO[];
  generation: {
    agent: string;
    promptVersion: string;
    model: string;
    usage: { promptTokens: number; completionTokens: number; costUsd?: number };
    durationMs: number;
    knowledgeFragments: number;
    /** Fragmentos de documentación de referencia (SGA, GRE, procedimientos…) que recibió el agente. */
    referenceFragments?: number;
    /** Fragmentos de documentos del producto (FDS de las materias primas, de análogos…) que recibió el agente. */
    productDocumentFragments?: number;
    /** Redactada por etapas (datos y clasificación primero, medidas después). */
    staged?: boolean;
    errors: string[];
  };
}

/** Una FDS en el listado (sin las secciones). */
export interface SdsDocumentSummaryDTO {
  id: string;
  status: string;
  version: number;
  language: string;
  productName: string | null;
  productCas: string | null;
  isMixture: boolean;
  components: SdsDocumentContentDTO['components'];
  /** Campos con dato / campos de la plantilla, en las 16 secciones. */
  filledFields: number;
  totalFields: number;
  createdAt: string;
  updatedAt: string;
}

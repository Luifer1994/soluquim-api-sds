import { SubstanceSourceDataDTO } from '@/modules/substance/substancesourcedata/dto';

export interface SubstanceSourcesSummaryDTO {
  total: number;
  ok: number;
  notFound: number;
  failed: number;
  /** Fuentes lentas encargadas al worker: estarán en el cache en la próxima consulta. */
  pending: number;
  fromCache: number;
  stale: number;
}

/** Una sustancia con los datos que trajo cada fuente. */
export interface SubstanceResponseDTO {
  cas: string;
  name: string | null;
  iupacName: string | null;
  molecularFormula: string | null;
  synonyms: string[];
  summary: SubstanceSourcesSummaryDTO;
  sources: SubstanceSourceDataDTO[];
}

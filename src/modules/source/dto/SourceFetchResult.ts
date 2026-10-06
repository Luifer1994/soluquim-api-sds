import { SourceCodeEnum, SourceStatusEnum } from '@/modules/source/enums';
import { SourceRecord } from '@/modules/source/dto/SourceRecord';

/** Respuesta cruda de la fuente, para guardar como snapshot (auditoría y re-parseo sin volver a llamar). */
export interface RawSourcePayload {
  url: string;
  contentType: string;
  content: string;
}

/** Lo que devuelve un proveedor al consultar un CAS. Siempre se devuelve, aunque la fuente falle. */
export interface SourceFetchResult {
  source: SourceCodeEnum;
  cas: string;
  status: SourceStatusEnum;
  records: SourceRecord[];
  /** Página principal de la sustancia en la fuente. */
  sourceUrl?: string;
  raw?: RawSourcePayload;
  retrievedAt: Date;
  durationMs: number;
  error?: string;
}

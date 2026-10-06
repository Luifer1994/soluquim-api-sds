import { SourceCodeEnum, SourceRecord, SourceStatusEnum } from '@/modules/source';

/** Datos de UNA fuente para UN CAS, tal como se devuelven al cliente. */
export interface SubstanceSourceDataDTO {
  source: SourceCodeEnum;
  status: SourceStatusEnum;
  /** true si salió del cache de la BD (no se llamó a la fuente). */
  fromCache: boolean;
  /** true si la fuente falló y se devuelve el último dato bueno, aunque esté vencido. */
  stale: boolean;
  retrievedAt: string;
  expiresAt?: string;
  durationMs?: number;
  sourceUrl?: string;
  error?: string;
  /** Versión vigente del dato de esta fuente (sube cada vez que la fuente cambia algo). */
  version?: number;
  /** true si esta consulta trajo un contenido nuevo o distinto al guardado. */
  changed?: boolean;
  records: SourceRecord[];
}

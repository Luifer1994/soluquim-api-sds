import { SourceKindEnum } from '@/modules/source/enums';

/** Ficha descriptiva de una fuente: para documentar, auditar y mostrar en GET /sources. */
export interface SourceInfo {
  name: string;
  /** Organismo responsable. */
  owner: string;
  kind: SourceKindEnum;
  homepage: string;
  /** Secciones de la FDS (1–16) que alimenta. */
  sdsSections: number[];
  description: string;
}

/** Estado en vivo de una fuente (proceso actual). */
export interface SourceRuntimeState {
  enabled: boolean;
  /** 'closed' = normal · 'open' = se dejó de llamar por fallos seguidos · 'halfOpen' = probando si volvió. */
  circuit: 'closed' | 'open' | 'halfOpen' | 'isolated';
  /** Si la fuente pidió esperar (Retry-After), hasta cuándo. */
  pausedUntil?: string;
  cacheTtlDays: number;
  notFoundTtlDays: number;
  mode: 'inline' | 'background';
}

/**
 * Un dato normalizado extraído de una fuente. Todas las fuentes devuelven el mismo formato para que
 * luego se puedan comparar y combinar (p. ej. el punto de inflamación de PubChem vs. NIOSH).
 */
export interface SourceRecord {
  /** Clave normalizada, en inglés y por grupos: `identity.iupacName`, `physical.flashPoint`, `exposure.idlh`… */
  field: string;
  /** Nombre legible tal como lo presenta la fuente (para mostrar y auditar). */
  label: string;
  value: unknown;
  unit?: string;
  /** URL exacta de donde salió el dato (trazabilidad). */
  sourceUrl: string;
}

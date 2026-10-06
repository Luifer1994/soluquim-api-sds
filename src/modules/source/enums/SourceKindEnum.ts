/** Cómo se obtienen los datos de una fuente. */
export enum SourceKindEnum {
  /** API pública que responde JSON. */
  API_JSON = 'API_JSON',
  /** Páginas HTML estáticas leídas con un parser (web scraping, sin navegador). */
  HTML = 'HTML',
  /** Archivo descargable (CSV/XLSX) que se carga completo y se consulta en memoria. */
  DATASET = 'DATASET',
}

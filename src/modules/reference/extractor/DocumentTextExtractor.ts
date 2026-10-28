/** Texto de una página (PDF) o del documento completo (formatos sin páginas, como Word). */
export interface ExtractedPage {
  /** Número de página (1, 2…); null si el formato no tiene páginas. */
  number: number | null;
  text: string;
}

export interface ExtractedDocument {
  pages: ExtractedPage[];
  /** Páginas del documento; null si el formato no tiene páginas. */
  pageCount: number | null;
}

/**
 * Strategy de extracción de texto por formato. Para soportar un formato nuevo (Excel, PowerPoint, texto
 * plano…) se crea una clase que implemente este contrato y se registra en `DOCUMENT_TEXT_EXTRACTORS`
 * (ReferenceModule). Nada más cambia: la subida, el fragmentado y la búsqueda son los mismos.
 */
export interface DocumentTextExtractor {
  /** Nombre corto del formato ("PDF", "Word"). */
  readonly format: string;
  /** Extensiones que acepta, en minúsculas y sin punto. */
  readonly extensions: readonly string[];
  extract(content: Buffer): Promise<ExtractedDocument>;
}

/** Token de inyección de la lista de extractores registrados. */
export const DOCUMENT_TEXT_EXTRACTORS = Symbol('DOCUMENT_TEXT_EXTRACTORS');

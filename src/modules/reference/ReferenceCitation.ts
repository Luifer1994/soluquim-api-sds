/** `source` de las citas a documentación de referencia en la FDS (las de datos por CAS llevan el código de la fuente). */
export const REFERENCE_CITATION_SOURCE = 'REFERENCE';

/** `source` de las citas a los documentos del producto (FDS de las materias primas, de análogos…). */
export const PRODUCT_DOCUMENT_CITATION_SOURCE = 'PRODUCT_DOCUMENT';

/** `source` de las citas a la normativa del perfil de país (sección 15). */
export const COUNTRY_PROFILE_CITATION_SOURCE = 'COUNTRY_PROFILE';

/** "GRE 2024 · p. 155–156" → "GRE 2024": el documento de una cita, sin las páginas. */
export const referenceDocumentOf = (citationTitle: string): string => citationTitle.split(' · p. ')[0];

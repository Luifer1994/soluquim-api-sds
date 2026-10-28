import { ReferenceDocumentCategory, ReferenceDocumentScope, ReferenceDocumentStatus } from '@prisma/client';

export interface ReferenceDocumentResponseDTO {
  id: string;
  title: string;
  description: string | null;
  category: ReferenceDocumentCategory;
  scope: ReferenceDocumentScope;
  /** Documento del producto: CAS del componente que describe. */
  cas: string | null;
  language: string;
  /** Secciones de la FDS a las que aporta; vacío = a todas. */
  sdsSections: number[];
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: ReferenceDocumentStatus;
  pageCount: number | null;
  chunkCount: number;
  embeddedCount: number;
  error: string | null;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lo que acepta la subida (para mostrarlo en el formulario). */
export interface ReferenceDocumentOptionsDTO {
  /** Extensiones aceptadas, sin punto. */
  extensions: string[];
  maxSizeBytes: number;
  /** Categorías de la biblioteca. */
  categories: ReferenceDocumentCategory[];
  /** Categorías de un documento del producto. */
  productCategories: ReferenceDocumentCategory[];
}

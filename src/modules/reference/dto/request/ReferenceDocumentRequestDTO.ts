import { ReferenceDocumentCategory, ReferenceDocumentScope } from '@prisma/client';
import { z } from 'zod';
import { CasNumberSchema } from '@/shared/validation';

export const ReferenceDocumentIdParamsSchema = z.object({ id: z.uuid({ error: 'id debe ser un UUID' }) });
export type ReferenceDocumentIdParamsDTO = z.infer<typeof ReferenceDocumentIdParamsSchema>;

/**
 * Secciones de la FDS a las que aporta el documento. En multipart llegan como texto ("4,5,6" o "[4,5,6]");
 * en JSON como arreglo. Vacío = a todas.
 */
const SdsSectionsSchema = z
  .union([z.array(z.coerce.number()), z.string()])
  .transform((value) =>
    Array.isArray(value)
      ? value
      : value
          .replace(/[[\]\s]/g, '')
          .split(',')
          .filter(Boolean)
          .map(Number),
  )
  .pipe(z.array(z.number().int().min(1, 'Sección entre 1 y 16').max(16, 'Sección entre 1 y 16')))
  .transform((sections) => [...new Set(sections)].sort((a, b) => a - b));

/** Categorías de la biblioteca de referencia. */
export const LIBRARY_DOCUMENT_CATEGORIES: readonly ReferenceDocumentCategory[] = [
  ReferenceDocumentCategory.REGULATION,
  ReferenceDocumentCategory.GUIDE,
  ReferenceDocumentCategory.MANUAL,
  ReferenceDocumentCategory.PROCEDURE,
  ReferenceDocumentCategory.DATABASE,
  ReferenceDocumentCategory.OTHER,
];

/** Categorías de un documento del producto. */
export const PRODUCT_DOCUMENT_CATEGORIES: readonly ReferenceDocumentCategory[] = [
  ReferenceDocumentCategory.SUPPLIER_SDS,
  ReferenceDocumentCategory.ANALOGOUS_SDS,
  ReferenceDocumentCategory.PRODUCT_DATA,
  ReferenceDocumentCategory.OTHER,
];

/** Lo que acepta cada alcance (una categoría fuera de su lista se rechaza al subir y al editar). */
export const DOCUMENT_CATEGORIES_BY_SCOPE: Record<ReferenceDocumentScope, readonly ReferenceDocumentCategory[]> = {
  [ReferenceDocumentScope.LIBRARY]: LIBRARY_DOCUMENT_CATEGORIES,
  [ReferenceDocumentScope.PRODUCT]: PRODUCT_DOCUMENT_CATEGORIES,
};

const metadata = {
  title: z.string().trim().min(1, 'El título es obligatorio').max(200),
  description: z.string().trim().max(2000).optional(),
  /** Sin categoría: OTHER en la biblioteca, FDS del proveedor en un documento del producto. */
  category: z.enum(ReferenceDocumentCategory).optional(),
  language: z.enum(['es', 'en', 'pt']).default('es'),
  sdsSections: SdsSectionsSchema.default([]),
};

/** POST /reference-documents (multipart): el archivo va en el campo `file`; estos son los demás campos. */
export const UploadReferenceDocumentSchema = z
  .object({
    ...metadata,
    /** LIBRARY: lo consulta toda generación. PRODUCT: solo las generaciones que lo adjuntan. */
    scope: z.enum(ReferenceDocumentScope).default(ReferenceDocumentScope.LIBRARY),
    /** Documento del producto: CAS del componente que describe (su FDS del proveedor). */
    cas: z.preprocess((v) => (v === '' ? undefined : v), CasNumberSchema.optional()),
  })
  .refine((body) => !body.category || DOCUMENT_CATEGORIES_BY_SCOPE[body.scope].includes(body.category), {
    message: 'Esa categoría no corresponde al alcance del documento',
    path: ['category'],
  });
export type UploadReferenceDocumentDTO = z.infer<typeof UploadReferenceDocumentSchema>;

/** PATCH /reference-documents/{id}: solo los datos descriptivos (el archivo no se reemplaza). */
export const UpdateReferenceDocumentSchema = z
  .object({
    title: metadata.title.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: z.enum(ReferenceDocumentCategory).optional(),
    language: z.enum(['es', 'en', 'pt']).optional(),
    sdsSections: SdsSectionsSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), 'Nada que actualizar');
export type UpdateReferenceDocumentDTO = z.infer<typeof UpdateReferenceDocumentSchema>;

/** GET /reference-documents: la biblioteca por defecto; o los documentos de producto pedidos por id. */
export const ListReferenceDocumentsQuerySchema = z.object({
  scope: z.enum(ReferenceDocumentScope).default(ReferenceDocumentScope.LIBRARY),
  ids: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(
      z
        .array(z.uuid({ error: 'ids debe tener UUIDs separados por coma' }))
        .max(50)
        .optional(),
    ),
});
export type ListReferenceDocumentsQueryDTO = z.infer<typeof ListReferenceDocumentsQuerySchema>;

/** Archivo recibido por multer (solo lo que se usa). */
export interface UploadedReferenceFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

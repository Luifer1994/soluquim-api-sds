import { z } from 'zod';
import { CasNumberSchema } from '@/shared/validation';

export const SdsDocumentIdParamsSchema = z.object({ id: z.uuid({ error: 'id debe ser un UUID' }) });
export type SdsDocumentIdParamsDTO = z.infer<typeof SdsDocumentIdParamsSchema>;

export const ListSdsDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListSdsDocumentsQueryDTO = z.infer<typeof ListSdsDocumentsQuerySchema>;

export const SdsDocumentFieldParamsSchema = z.object({
  id: z.uuid({ error: 'id debe ser un UUID' }),
  number: z.coerce.number().int().min(1).max(16),
  key: z.string().trim().min(1).max(80),
});
export type SdsDocumentFieldParamsDTO = z.infer<typeof SdsDocumentFieldParamsSchema>;

/**
 * PATCH de un campo de la FDS. `value` null o vacío = dejar el campo sin dato.
 * `source`: de qué fuente tomó el usuario el valor (queda como cita); sin `source` es texto del usuario.
 * `restoreProposed`: vuelve a dejar la sugerencia original (la guardada o, si no quedó, la que se arma
 * con las fuentes de esa sección) y la persiste.
 */
export const UpdateSdsDocumentFieldSchema = z
  .object({
    value: z
      .string()
      .trim()
      .max(20000)
      .nullable()
      .optional()
      .transform((value) => (value == null ? value : value || null)),
    source: z
      .object({
        source: z.string().trim().min(1).max(40),
        cas: CasNumberSchema,
      })
      .optional(),
    restoreProposed: z.boolean().optional(),
  })
  .refine((data) => data.restoreProposed === true || data.value !== undefined, {
    message: 'Indica el valor del campo o pide volver a la sugerencia',
  });
export type UpdateSdsDocumentFieldDTO = z.infer<typeof UpdateSdsDocumentFieldSchema>;

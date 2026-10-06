import { z } from 'zod';
import { CasNumberSchema } from '@/shared/validation';

/** POST /knowledge/sync — un CAS o una lista de componentes (con o sin porcentaje). */
export const SyncKnowledgeRequestSchema = z
  .object({
    cas: CasNumberSchema.optional(),
    components: z
      .array(z.object({ cas: CasNumberSchema, percentage: z.number().optional() }))
      .max(50)
      .optional(),
    /** true = consultar todas las fuentes aunque haya cache (detectar cambios). */
    refresh: z.boolean().default(false),
  })
  .refine((body) => body.cas || body.components?.length, { message: 'Indique "cas" o "components"' });
export type SyncKnowledgeRequestDTO = z.infer<typeof SyncKnowledgeRequestSchema>;

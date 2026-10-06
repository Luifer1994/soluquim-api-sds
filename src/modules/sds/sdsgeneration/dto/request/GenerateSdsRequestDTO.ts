import { z } from 'zod';
import { CasNumberSchema } from '@/shared/validation';
import { MixtureComponentsSchema } from '@/modules/sds/sdsmixture/dto/request';

/** POST /generations — una sustancia (1 componente al 100 %) o una mezcla. */
export const GenerateSdsRequestSchema = z.object({
  components: MixtureComponentsSchema,
  language: z.enum(['es', 'en']).default('es'),
  /** ISO 3166-1 alfa-2 (CO, MX, ES…). Opcional por ahora: aún no hay normativa por país en el RAG. */
  destinationCountry: z
    .string()
    .trim()
    .length(2, 'Código de país ISO de 2 letras')
    .transform((v) => v.toUpperCase())
    .optional(),
  product: z
    .object({
      name: z.string().trim().min(1).max(255).optional(),
      /** CAS del PRODUCTO, si tiene uno propio (una mezcla puede tenerlo además de los CAS de sus componentes). */
      cas: CasNumberSchema.optional(),
      /** Producto en Soluquim (referencia, sin FK). */
      productId: z.uuid().optional(),
    })
    .optional(),
});
export type GenerateSdsRequestDTO = z.infer<typeof GenerateSdsRequestSchema>;

export const JobIdParamsSchema = z.object({ jobId: z.uuid({ error: 'jobId debe ser un UUID' }) });

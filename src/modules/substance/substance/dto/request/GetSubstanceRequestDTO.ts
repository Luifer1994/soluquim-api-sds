import { z } from 'zod';
import { CasNumberSchema } from '@/shared/validation';

export const GetSubstanceParamsSchema = z.object({ cas: CasNumberSchema });
export type GetSubstanceParamsDTO = z.infer<typeof GetSubstanceParamsSchema>;

export const GetSubstanceQuerySchema = z.object({
  /** `true` ignora el cache y vuelve a consultar las fuentes. */
  refresh: z.stringbool({ error: 'refresh debe ser true o false' }).default(false),
});
export type GetSubstanceQueryDTO = z.infer<typeof GetSubstanceQuerySchema>;

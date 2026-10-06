import { z } from 'zod';
import { CasNumberSchema } from '@/shared/validation';

export const CasParamsSchema = z.object({ cas: CasNumberSchema });
export type CasParamsDTO = z.infer<typeof CasParamsSchema>;

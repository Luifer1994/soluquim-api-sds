import { z } from 'zod';
import { CasNumberSchema } from '@/shared/validation';

/** GET /knowledge/search?cas=64-17-5,7732-18-5&sections=4,5&q=… */
export const SearchKnowledgeQuerySchema = z.object({
  cas: z.preprocess(
    (v) =>
      typeof v === 'string'
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : v,
    z.array(CasNumberSchema).min(1, 'Indique al menos un CAS').max(50),
  ),
  sections: z
    .preprocess(
      (v) =>
        typeof v === 'string'
          ? v
              .split(',')
              .map((s) => Number(s.trim()))
              .filter((n) => !Number.isNaN(n))
          : v,
      z.array(z.number().int().min(1).max(16)).min(1),
    )
    .default(Array.from({ length: 16 }, (_, i) => i + 1)),
  q: z.string().trim().max(500).optional(),
  perCas: z.coerce.number().int().min(1).max(50).default(8),
});
export type SearchKnowledgeQueryDTO = z.infer<typeof SearchKnowledgeQuerySchema>;

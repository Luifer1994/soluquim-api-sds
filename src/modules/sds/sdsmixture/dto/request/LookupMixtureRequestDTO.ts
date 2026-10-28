import { z } from 'zod';
import { CasNumberSchema } from '@/shared/validation';

export const MAX_MIXTURE_COMPONENTS = 50;
/** Tolerancia de redondeo al validar que la suma no pase de 100 %. */
const PERCENTAGE_TOLERANCE = 0.01;

/** Símbolos de una concentración (los mismos de los componentes del producto en core). */
export const CONCENTRATION_SYMBOLS = ['=', '>', '<', '>=', '<='] as const;
export type ConcentrationSymbol = (typeof CONCENTRATION_SYMBOLS)[number];

const PercentageSchema = z
  .number({ error: 'El porcentaje debe ser un número' })
  .gt(0, 'El porcentaje debe ser mayor que 0')
  .max(100, 'El porcentaje no puede ser mayor que 100');

/**
 * Un componente con su concentración como la declaran las FDS: un valor (`percentage`), con símbolo opcional
 * ("<= 99", ">= 1"), o un rango (`percentage` = desde, `percentageMax` = hasta, cada uno con su símbolo).
 */
export const MixtureComponentSchema = z
  .object({
    cas: CasNumberSchema,
    percentage: PercentageSchema,
    symbol: z.enum(CONCENTRATION_SYMBOLS).optional(),
    percentageMax: PercentageSchema.optional(),
    symbolMax: z.enum(CONCENTRATION_SYMBOLS).optional(),
  })
  .refine((c) => c.percentageMax === undefined || c.percentageMax >= c.percentage, {
    message: 'El porcentaje máximo del rango no puede ser menor que el mínimo',
    path: ['percentageMax'],
  })
  .refine((c) => c.symbolMax === undefined || c.percentageMax !== undefined, {
    message: 'symbolMax solo aplica a un rango (con percentageMax)',
    path: ['symbolMax'],
  });

export const MixtureComponentsSchema = z
  .array(MixtureComponentSchema, {
    error: 'components debe ser una lista de { cas, percentage, symbol?, percentageMax?, symbolMax? }',
  })
  .min(1, 'La mezcla debe tener al menos un componente')
  .max(MAX_MIXTURE_COMPONENTS, `La mezcla no puede tener más de ${MAX_MIXTURE_COMPONENTS} componentes`)
  // En un rango cuenta el mínimo: la suma de los mínimos no puede pasar de 100 %.
  .superRefine((components, ctx) => {
    const total = components.reduce((sum, component) => sum + component.percentage, 0);
    if (total > 100 + PERCENTAGE_TOLERANCE) {
      ctx.addIssue({
        code: 'custom',
        message: `Los porcentajes suman ${Math.round(total * 100) / 100} %; no pueden superar 100 %`,
      });
    }
  });

/** POST /mixtures/lookup — body JSON. */
export const LookupMixtureRequestSchema = z.object({
  components: MixtureComponentsSchema,
  /** `true` ignora el cache y vuelve a consultar las fuentes. */
  refresh: z.boolean().default(false),
});
export type LookupMixtureRequestDTO = z.infer<typeof LookupMixtureRequestSchema>;
export type MixtureComponentDTO = z.infer<typeof MixtureComponentSchema>;

/**
 * GET /mixtures/lookup?components=64-17-5:70,7732-18-5:30 — misma validación que el POST, para
 * poder probar desde el navegador. Formato: `cas:porcentaje` separados por coma.
 */
export const LookupMixtureQuerySchema = z.object({
  components: z.preprocess(
    (value) =>
      typeof value === 'string'
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => {
              const [cas, percentage] = item.split(':').map((part) => part?.trim());
              return {
                cas,
                percentage: percentage === undefined || percentage === '' ? undefined : Number(percentage),
              };
            })
        : value,
    MixtureComponentsSchema,
  ),
  refresh: z.stringbool({ error: 'refresh debe ser true o false' }).default(false),
});

import { z } from 'zod';

/** Lo que responde un especialista cuando el líder de calidad le consulta un punto. */
export const SdsSpecialistOpinionSchema = z.object({
  verdict: z
    .enum(['consistent', 'inconsistent', 'uncertain'])
    .describe('consistent: está bien; inconsistent: hay un error o contradicción; uncertain: las fuentes no alcanzan'),
  correctedValue: z
    .string()
    .nullable()
    .describe('Valor correcto si es inconsistent y las fuentes lo respaldan; si no, null'),
  rationale: z.string().describe('Por qué, en 1-3 frases, con el dato de la fuente'),
  sources: z.array(z.string()).describe('Fuentes que respaldan la opinión (CAS y fuente, o URL)'),
});
export type SdsSpecialistOpinion = z.infer<typeof SdsSpecialistOpinionSchema>;

export const SdsQualityIssueSchema = z.object({
  section: z.number().int().min(2).max(14).describe('Sección donde está el campo a corregir'),
  field: z.string().min(1).describe('Etiqueta del campo, tal como aparece en la ficha'),
  problem: z.string().min(1).describe('Qué está mal o contradice a otra sección, concreto'),
  suggestion: z.string().nullable().describe('Valor sugerido si un especialista lo confirmó con fuentes; si no, null'),
  relatedSections: z.array(z.number().int().min(1).max(16)).describe('Otras secciones involucradas'),
  severity: z.enum(['high', 'medium', 'low']).describe('high: riesgo para la seguridad o error regulatorio'),
});
export type SdsQualityIssue = z.infer<typeof SdsQualityIssueSchema>;

/** Resultado de la revisión de coherencia de toda la ficha. */
export const SdsQualityReviewSchema = z.object({
  issues: z.array(SdsQualityIssueSchema).max(30),
});
export type SdsQualityReview = z.infer<typeof SdsQualityReviewSchema>;

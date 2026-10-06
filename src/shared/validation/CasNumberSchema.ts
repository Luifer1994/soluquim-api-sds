import { z } from 'zod';
import { isValidCas } from '@/shared/validation/CasNumberValidator';

/** Número CAS validado (formato + dígito verificador). Reutilizable en cualquier DTO. */
export const CasNumberSchema = z
  .string({ error: 'El número CAS es obligatorio' })
  .trim()
  .refine(isValidCas, { message: 'Número CAS inválido (formato NNNNNNN-NN-N con dígito verificador correcto)' });

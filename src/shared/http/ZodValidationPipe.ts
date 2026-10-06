import { Injectable, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';
import { ValidationException } from '@/shared/exception';

/**
 * Valida y transforma el body/query con un schema Zod. Errores → 422 con `{ campo: mensaje }`.
 *
 * Uso: `@Body(new ZodValidationPipe(GenerateSdsRequestSchema)) body: GenerateSdsRequestDTO`
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;

    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.length ? issue.path.join('.') : '_root';
      errors[field] ??= issue.message;
    }
    throw new ValidationException(errors);
  }
}

import { z } from 'zod';
import { toToolParameters } from '@/shared/ai';

describe('toToolParameters (schema que se le envía al modelo)', () => {
  it('quita las restricciones de validación y conserva forma, enums, requeridos y descripciones', () => {
    const schema = z.object({
      items: z.array(z.object({ section: z.number().int().min(2).max(14), severity: z.enum(['high', 'low']) })).max(30),
      query: z.string().min(3).describe('Qué buscar'),
      // Un campo que se llama como una palabra de JSON Schema no se toca.
      pattern: z.string(),
    });
    const parameters = toToolParameters(schema);
    const text = JSON.stringify(parameters);

    expect(text).not.toMatch(/"(\$schema|minimum|maximum|maxItems|minLength)"/);
    expect(parameters).toMatchObject({
      type: 'object',
      required: ['items', 'query', 'pattern'],
      properties: {
        query: { type: 'string', description: 'Qué buscar' },
        pattern: { type: 'string' },
        items: { type: 'array', items: { properties: { severity: { enum: ['high', 'low'] } } } },
      },
    });
  });
});

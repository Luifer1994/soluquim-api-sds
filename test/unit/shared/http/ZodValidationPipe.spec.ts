import { z } from 'zod';
import { ValidationException } from '@/shared/exception';
import { ZodValidationPipe } from '@/shared/http';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string().min(1, 'El nombre es obligatorio'),
    items: z.array(z.object({ qty: z.number().positive('Debe ser mayor a 0') })),
  });
  const pipe = new ZodValidationPipe(schema);

  it('devuelve el valor parseado si es válido', () => {
    expect(pipe.transform({ name: 'x', items: [{ qty: 1 }] })).toEqual({ name: 'x', items: [{ qty: 1 }] });
  });

  it('lanza 422 con el detalle por campo (mismo contrato que Java)', () => {
    try {
      pipe.transform({ name: '', items: [{ qty: 0 }] });
      fail('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      const ex = error as ValidationException;
      expect(ex.statusCode).toBe(422);
      expect(ex.data).toEqual({ name: 'El nombre es obligatorio', 'items.0.qty': 'Debe ser mayor a 0' });
    }
  });
});

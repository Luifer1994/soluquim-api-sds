import { LookupMixtureQuerySchema, LookupMixtureRequestSchema } from '@/modules/sds/sdsmixture/dto/request';

describe('Validación de la mezcla', () => {
  it('acepta una mezcla válida', () => {
    const parsed = LookupMixtureRequestSchema.parse({
      components: [
        { cas: '64-17-5', percentage: 70 },
        { cas: '7732-18-5', percentage: 30 },
      ],
    });
    expect(parsed.refresh).toBe(false);
  });

  it('rechaza un CAS con dígito verificador incorrecto', () => {
    const result = LookupMixtureRequestSchema.safeParse({ components: [{ cas: '64-17-4', percentage: 10 }] });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(['components', 0, 'cas']);
  });

  it('rechaza porcentajes que suman más de 100', () => {
    const result = LookupMixtureRequestSchema.safeParse({
      components: [
        { cas: '64-17-5', percentage: 80 },
        { cas: '7732-18-5', percentage: 30 },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].message).toMatch(/suman 110 %/);
  });

  it('rechaza porcentaje 0 o negativo y lista vacía', () => {
    expect(LookupMixtureRequestSchema.safeParse({ components: [{ cas: '64-17-5', percentage: 0 }] }).success).toBe(
      false,
    );
    expect(LookupMixtureRequestSchema.safeParse({ components: [] }).success).toBe(false);
  });

  it('GET: parsea "cas:porcentaje,cas:porcentaje"', () => {
    const parsed = LookupMixtureQuerySchema.parse({ components: '64-17-5:70, 7732-18-5:30', refresh: 'true' });
    expect(parsed).toEqual({
      components: [
        { cas: '64-17-5', percentage: 70 },
        { cas: '7732-18-5', percentage: 30 },
      ],
      refresh: true,
    });
  });

  it('GET: un componente sin porcentaje es un error de validación', () => {
    const result = LookupMixtureQuerySchema.safeParse({ components: '64-17-5' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(['components', 0, 'percentage']);
  });
});

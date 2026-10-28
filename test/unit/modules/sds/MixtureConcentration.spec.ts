import { MixtureConcentration, MixtureComponentSchema, MixtureNormalizer } from '@/modules/sds/sdsmixture';

describe('MixtureConcentration (concentración con símbolo o rango)', () => {
  it('la escribe como en las FDS', () => {
    expect(MixtureConcentration.label({ percentage: 99, symbol: '<=' })).toBe('≤ 99 %');
    expect(MixtureConcentration.label({ percentage: 1, symbol: '>=' })).toBe('≥ 1 %');
    expect(MixtureConcentration.label({ percentage: 0.5 })).toBe('0,5 %');
    expect(MixtureConcentration.label({ percentage: 10, symbol: '>=', percentageMax: 20, symbolMax: '<' })).toBe(
      '≥ 10 – < 20 %',
    );
  });

  it('para los peligros toma el máximo posible; un "<" no alcanza su propio valor', () => {
    expect(MixtureConcentration.upper({ percentage: 10, percentageMax: 20 })).toBe(20);
    expect(MixtureConcentration.upper({ percentage: 0.1, symbol: '<' })).toBeLessThan(0.1);
    expect(MixtureConcentration.upper({ percentage: 0.1, symbol: '<=' })).toBe(0.1);
  });

  it('valida el rango: el máximo no puede ser menor que el mínimo', () => {
    expect(MixtureComponentSchema.safeParse({ cas: '64-17-5', percentage: 20, percentageMax: 10 }).success).toBe(false);
    expect(MixtureComponentSchema.safeParse({ cas: '64-17-5', percentage: 10, symbolMax: '<' }).success).toBe(false);
  });

  it('el normalizador conserva el símbolo y ordena por el máximo', () => {
    const { components } = MixtureNormalizer.normalize([
      { cas: '77-09-8', percentage: 1, symbol: '>=' },
      { cas: '64-17-5', percentage: 90, symbol: '>=', percentageMax: 99, symbolMax: '<=' },
    ]);
    expect(components).toEqual([
      { cas: '64-17-5', percentage: 90, symbol: '>=', percentageMax: 99, symbolMax: '<=' },
      { cas: '77-09-8', percentage: 1, symbol: '>=' },
    ]);
  });
});

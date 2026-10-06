import { MixtureNormalizer } from '@/modules/sds/sdsmixture/normalizer';

describe('MixtureNormalizer', () => {
  it('ordena por porcentaje descendente', () => {
    const { components } = MixtureNormalizer.normalize([
      { cas: '7732-18-5', percentage: 30 },
      { cas: '64-17-5', percentage: 70 },
    ]);
    expect(components.map((c) => c.cas)).toEqual(['64-17-5', '7732-18-5']);
  });

  it('fusiona CAS repetidos sumando porcentajes y lo informa', () => {
    const result = MixtureNormalizer.normalize([
      { cas: '64-17-5', percentage: 40 },
      { cas: '7732-18-5', percentage: 30 },
      { cas: '64-17-5', percentage: 30 },
    ]);
    expect(result.components).toEqual([
      { cas: '64-17-5', percentage: 70 },
      { cas: '7732-18-5', percentage: 30 },
    ]);
    expect(result.mergedDuplicates).toEqual(['64-17-5']);
    expect(result.totalPercentage).toBe(100);
  });

  it('redondea a 4 decimales (sin errores de coma flotante)', () => {
    const result = MixtureNormalizer.normalize([
      { cas: '64-17-5', percentage: 0.1 },
      { cas: '64-17-5', percentage: 0.2 },
    ]);
    expect(result.components[0].percentage).toBe(0.3);
  });

  it('no muta la entrada', () => {
    const input = [
      { cas: '7732-18-5', percentage: 30 },
      { cas: '64-17-5', percentage: 70 },
    ];
    const copy = structuredClone(input);
    MixtureNormalizer.normalize(input);
    expect(input).toEqual(copy);
  });
});

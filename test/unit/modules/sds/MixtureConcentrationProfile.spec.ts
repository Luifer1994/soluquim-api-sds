import { CurrentSourceData } from '@/modules/substance';
import { MixtureConcentrationProfile } from '@/modules/sds/sdsgeneration/assembler';

const echa = (cas: string, harmonised: unknown[], notified?: unknown): CurrentSourceData =>
  ({
    cas,
    substanceName: cas,
    sources: [
      {
        source: 'ECHA',
        status: 'OK',
        version: 1,
        sourceUrl: 'u',
        records: [
          { field: 'ghs.harmonised', label: '', value: harmonised, sourceUrl: 'u' },
          ...(notified ? [{ field: 'ghs.notified', label: '', value: notified, sourceUrl: 'u' }] : []),
        ],
      },
    ],
  });

// Fenolftaleína 1 % en etanol (ejemplo real del procedimiento): ECHA armonizada + notificada.
const phenolphthalein = echa('77-09-8', [
  {
    hazardClasses: [
      { code: 'Carc. 1B', hazardStatements: [{ code: 'H350' }] },
      { code: 'Muta. 2', hazardStatements: [{ code: 'H341' }] },
      { code: 'Repr. 2', hazardStatements: [{ code: 'H361f' }] },
    ],
    specificConcentrationLimits: [{ range: 'C ≥ 1 %', hazardClasses: ['Carc. 1B'] }],
  },
]);
const ethanol = echa('64-17-5', [{ hazardClasses: [{ code: 'Flam. Liq. 2', hazardStatements: [{ code: 'H225' }] }] }], {
  dominant: { hazardClasses: [{ code: 'Eye Irrit. 2', hazardStatements: [{ code: 'H319' }] }] },
});

describe('MixtureConcentrationProfile (qué aporta cada componente según su %)', () => {
  const profiles = MixtureConcentrationProfile.build(
    [
      { cas: '64-17-5', name: 'Etanol', percentage: 99 },
      { cas: '77-09-8', name: 'Fenolftaleína', percentage: 1 },
    ],
    [ethanol, phenolphthalein],
  );
  const verdict = (cas: string, hazardClass: string) =>
    profiles.find((p) => p.cas === cas)!.contributions.find((c) => c.hazardClass === hazardClass);

  it('aplica el límite específico de ECHA cuando existe (Carc. 1B, C ≥ 1 %)', () => {
    expect(verdict('77-09-8', 'Carc. 1B')).toMatchObject({ limitKind: 'specific', verdict: 'reaches' });
  });

  it('aplica el límite genérico del SGA (Muta. 2 ≥ 1 %) y marca los de doble límite (Repr. 2: 0,1 % / 3 %)', () => {
    expect(verdict('77-09-8', 'Muta. 2')).toMatchObject({ limitKind: 'generic', verdict: 'reaches' });
    expect(verdict('77-09-8', 'Repr. 2')).toMatchObject({ verdict: 'authority-dependent' });
  });

  it('los peligros físicos no se calculan por % y la notificada completa lo que la armonizada no cubre', () => {
    expect(verdict('64-17-5', 'Flam. Liq. 2')).toMatchObject({ verdict: 'not-by-concentration' });
    expect(verdict('64-17-5', 'Eye Irrit. 2')).toMatchObject({ origin: 'notified', verdict: 'additive' });
  });

  it('por debajo del límite específico no aporta', () => {
    const [low] = MixtureConcentrationProfile.build(
      [{ cas: '77-09-8', name: 'F', percentage: 0.5 }],
      [phenolphthalein],
    );
    expect(low.contributions.find((c) => c.hazardClass === 'Carc. 1B')!.verdict).toBe('below');
  });

  it('lee los rangos de los SCL', () => {
    expect(MixtureConcentrationProfile.bounds('C ≥ 1 %')).toEqual({ low: 1, high: null });
    expect(MixtureConcentrationProfile.bounds('>= 50')).toEqual({ low: 50, high: null });
    expect(MixtureConcentrationProfile.bounds('0,1 % ≤ C < 1 %')).toEqual({ low: 0.1, high: 1 });
  });

  it('el bloque para el agente nombra componente, %, clase, límite y conclusión', () => {
    const text = MixtureConcentrationProfile.render(profiles);
    expect(text).toContain('Fenolftaleína (CAS 77-09-8) 1 %');
    expect(text).toContain('Carc. 1B (H350)');
    expect(text).toContain('ALCANZA');
  });
});

describe('MixtureConcentrationProfile con el criterio del país', () => {
  it('Colombia (límite menor): Repr. 2 al 1 % ALCANZA, como en la justificación de la calculadora SGA', () => {
    const [profile] = MixtureConcentrationProfile.build(
      [{ cas: '77-09-8', name: 'Fenolftaleína', percentage: 1 }],
      [phenolphthalein],
      { lowerCutOffs: true },
    );
    const repr = profile.contributions.find((c) => c.hazardClass === 'Repr. 2')!;
    expect(repr.verdict).toBe('reaches');
    expect(repr.limit).toContain('0,1 %');
  });
});

import { SdsSectionCatalog } from '@/modules/knowledge';
import { SectionSuggestionBuilder, MixturePropertyFilter } from '@/modules/sds/sdsgeneration/assembler';

const components = [
  { cas: '64-17-5', name: 'Etanol', percentage: 99 },
  { cas: '77-09-8', name: 'Fenolftaleína', percentage: 1 },
];
const section9 = () =>
  SectionSuggestionBuilder.fromValues(
    SdsSectionCatalog.forProduct(9, 'mixture'),
    {
      meltingPoint: '-114 °C (Etanol)',
      particleCharacteristics: 'Fenolftaleína: 56,6 μm',
      otherInformation: 'Etanol: tensión superficial 22,31 mN/m\nFenolftaleína: densidad aparente 350 kg/m3',
    },
    'system',
    'es',
  );
const valueOf = (suggestion: ReturnType<typeof section9>, key: string) =>
  suggestion.subsections.flatMap((sub) => sub.fields).find((field) => field.key === key)?.value;

describe('MixturePropertyFilter (sección 9 de una mezcla)', () => {
  it('quita las líneas de componentes minoritarios y las deja para el revisor', () => {
    const filtered = MixturePropertyFilter.apply(section9(), components, 'es');
    expect(valueOf(filtered, 'meltingPoint')).toBe('-114 °C (Etanol)');
    expect(valueOf(filtered, 'particleCharacteristics')).toBeNull();
    expect(valueOf(filtered, 'otherInformation')).toBe('Etanol: tensión superficial 22,31 mN/m');
    expect(filtered.discarded.map((d) => d.key)).toEqual(['particleCharacteristics', 'otherInformation']);
    expect(filtered.content).not.toContain('Fenolftaleína');
  });

  it('no filtra una sustancia ni una mezcla sin componente mayoritario', () => {
    const balanced = components.map((c) => ({ ...c, percentage: 40 }));
    expect(MixturePropertyFilter.apply(section9(), [components[0]], 'es')).toEqual(section9());
    expect(MixturePropertyFilter.apply(section9(), balanced, 'es')).toEqual(section9());
  });
});

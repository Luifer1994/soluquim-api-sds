import { SdsSectionCatalog } from '@/modules/knowledge/catalog';
import { SourceKnowledgeChunker } from '@/modules/knowledge/chunker';

const records = [
  { field: 'identity.name', label: 'Name', value: 'ETANOL (ANHIDRO)', sourceUrl: 'u' },
  {
    field: 'firstAid.byRoute',
    label: 'Primeros auxilios',
    value: { inhalation: 'Aire limpio, reposo.' },
    sourceUrl: 'u',
  },
  { field: 'exposure.occupationalLimits', label: 'Límites', value: ['TLV: 1000 ppm como STEL'], sourceUrl: 'u' },
  {
    field: 'ghs.harmonised',
    label: 'Harmonised',
    value: [{ hazardClasses: [{ code: 'Flam. Liq. 2' }] }],
    sourceUrl: 'u',
  },
  { field: 'meta.language', label: 'Idioma', value: 'es', sourceUrl: 'u' },
  { field: 'meta.attribution', label: 'Attribution', value: '© OIT/OMS', sourceUrl: 'u' },
];
const chunks = SourceKnowledgeChunker.chunk({ cas: '64-17-5', substanceName: 'Ethanol', source: 'ICSC', records });
const byKey = (key: string) => chunks.find((c) => c.chunkKey === key)!;

describe('SourceKnowledgeChunker', () => {
  it('agrupa por tema y deja aparte los campos grandes (ghs.*)', () => {
    expect(chunks.map((c) => c.chunkKey).sort()).toEqual(['exposure', 'firstAid', 'ghs.harmonised', 'identity']);
  });

  it('etiqueta cada fragmento con las secciones de la FDS que alimenta', () => {
    expect(byKey('firstAid').sdsSections).toEqual([4]);
    expect(byKey('exposure').sdsSections).toEqual([8, 15]);
    expect(byKey('ghs.harmonised').sdsSections).toEqual([2, 15]);
    expect(byKey('identity').sdsSections).toEqual([1, 3]);
  });

  it('el texto lleva fuente, cita, sustancia y los datos legibles (no JSON crudo)', () => {
    const content = byKey('firstAid').content;
    expect(content).toContain('Fuente: ICSC (© OIT/OMS)');
    expect(content).toContain('Sustancia: Ethanol (CAS 64-17-5)');
    expect(content).toContain('inhalation: Aire limpio, reposo.');
  });

  it('usa el idioma de la fuente y no indexa los meta.*', () => {
    expect(chunks.every((c) => c.language === 'es')).toBe(true);
    expect(chunks.some((c) => c.content.includes('Idioma'))).toBe(false);
  });

  it('el hash es estable: mismo contenido → mismo hash (no se re-vectoriza)', () => {
    const again = SourceKnowledgeChunker.chunk({ cas: '64-17-5', substanceName: 'Ethanol', source: 'ICSC', records });
    expect(again.map((c) => c.contentHash)).toEqual(chunks.map((c) => c.contentHash));
  });

  it('parte los fragmentos muy largos repitiendo el encabezado', () => {
    const long = Array.from({ length: 80 }, (_, i) => ({
      field: `physical.p${i}`,
      label: `Propiedad ${i}`,
      value: 'x'.repeat(60),
      sourceUrl: 'u',
    }));
    const parts = SourceKnowledgeChunker.chunk({
      cas: '64-17-5',
      substanceName: 'Ethanol',
      source: 'NIST',
      records: long,
    });
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.content.startsWith('Fuente: NIST') && p.content.length <= 2600)).toBe(true);
    expect(parts[0].chunkKey).toBe('physical#1');
  });

  it('catálogo: 16 secciones y campos desconocidos van a "Otras informaciones"', () => {
    expect(SdsSectionCatalog.all()).toHaveLength(16);
    expect(SdsSectionCatalog.sectionsForField('algo.raro')).toEqual([16]);
    expect(SdsSectionCatalog.sectionsForField('exposure.byRoute')).toEqual([4, 8, 11]);
  });
});

import { KnowledgeContextCandidate } from '@/modules/knowledge';
import { BuildSectionContextService } from '@/modules/knowledge/service';

const candidate = (
  source: string,
  chunkKey: string,
  tagged: boolean,
  similarity: number,
  size = 100,
): KnowledgeContextCandidate => ({
  id: `${source}:${chunkKey}`,
  cas: '64-17-5',
  source,
  chunkKey,
  title: '',
  content: 'x'.repeat(size),
  sdsSections: [],
  sourceUrl: null,
  language: 'es',
  tagged,
  similarity,
});

describe('BuildSectionContextService.select (contexto del agente)', () => {
  const candidates = [
    candidate('NIST', 'thermo', false, 0.2),
    candidate('ICSC', 'firstAid', true, 0.5),
    candidate('ICSC', 'health', false, 0.6),
    candidate('ECHA', 'ghs.harmonised', false, 0.1),
    candidate('PUBCHEM', 'identity', false, 0.1),
    candidate('NIOSH_NPG', 'firstAid', true, 0.7),
  ];

  it('orden: núcleo → fragmentos de la sección (por similitud) → relacionados (por similitud)', () => {
    const selected = BuildSectionContextService.select(candidates, 10_000);
    expect(selected.map((f) => `${f.relevance}:${f.source}`)).toEqual([
      'core:ECHA',
      'core:PUBCHEM',
      'section:NIOSH_NPG',
      'section:ICSC',
      'related:ICSC',
      'related:NIST',
    ]);
  });

  it('con presupuesto de sobra entra TODO el conocimiento de todas las fuentes', () => {
    expect(BuildSectionContextService.select(candidates, 10_000)).toHaveLength(candidates.length);
  });

  it('con presupuesto corto se quedan fuera los menos relevantes, nunca el núcleo', () => {
    const selected = BuildSectionContextService.select(candidates, 350);
    expect(selected.map((f) => f.relevance)).toEqual(['core', 'core', 'section']);
  });

  it('un fragmento grande que no cabe no bloquea a los siguientes más chicos', () => {
    const selected = BuildSectionContextService.select(
      [candidate('ICSC', 'a', true, 0.9, 5000), candidate('NIOSH_NPG', 'b', true, 0.8, 100)],
      1000,
    );
    expect(selected.map((f) => f.source)).toEqual(['NIOSH_NPG']);
  });
});

import { ReferenceChunkHit } from '@/modules/reference/repository';
import { BuildReferenceContextService } from '@/modules/reference/service';

const hit = (
  id: string,
  documentId: string,
  similarity: number | null,
  lexical = false,
  size = 100,
): ReferenceChunkHit => ({
  id,
  documentId,
  documentTitle: documentId === 'gre' ? 'GRE 2024' : 'Libro púrpura SGA',
  category: 'GUIDE',
  language: 'es',
  pageFrom: 10,
  pageTo: 11,
  content: 'x'.repeat(size),
  similarity,
  lexical,
});

describe('BuildReferenceContextService.select (documentación de referencia del agente)', () => {
  it('ordena por similitud y sube los que mencionan un identificador del producto (CAS, número ONU)', () => {
    const selected = BuildReferenceContextService.select(
      [hit('a', 'sga', 0.62), hit('b', 'gre', 0.5, true), hit('c', 'sga', 0.7)],
      10_000,
    );
    expect(selected.map((f) => f.id)).toEqual(['c', 'b', 'a']);
    expect(selected[0].citationTitle).toBe('Libro púrpura SGA · p. 10–11');
  });

  it('respeta el presupuesto y no deja que un documento acapare el contexto', () => {
    const candidates = [
      hit('s1', 'sga', 0.9, false, 400),
      hit('s2', 'sga', 0.85, false, 400),
      hit('g1', 'gre', 0.5, false, 400),
    ];
    // Presupuesto 1000: el SGA puede usar a lo sumo 600 → entra s1, s2 no, y queda espacio para la GRE.
    expect(BuildReferenceContextService.select(candidates, 1000).map((f) => f.id)).toEqual(['s1', 'g1']);
  });

  it('la consulta incluye las secciones, el producto, sus identificadores y sus peligros', () => {
    const query = BuildReferenceContextService.query({
      sections: [14],
      product: 'Etanol (CAS 64-17-5)',
      identifiers: ['64-17-5', 'UN1170'],
      terms: ['H225'],
    });
    expect(query).toContain('Etanol');
    expect(query).toContain('UN1170');
    expect(query).toContain('H225');
  });
});

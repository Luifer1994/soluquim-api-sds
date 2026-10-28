import { ProductChunkHit } from '@/modules/reference/repository';
import { BuildProductDocumentContextService, ProductDocument } from '@/modules/reference/service';

const supplier: ProductDocument = { id: 'etanol', title: 'FDS Etanol', category: 'SUPPLIER_SDS', cas: '64-17-5' };
const analogous: ProductDocument = {
  id: 'analogo',
  title: 'FDS Fenolftaleína 1 %',
  category: 'ANALOGOUS_SDS',
  cas: null,
};

const hit = (id: string, documentId: string, sdsSections: number[], tagged = true): ProductChunkHit => ({
  id,
  documentId,
  position: Number(id.replace(/\D/g, '')) || 0,
  pageFrom: 1,
  pageTo: 2,
  content: 'x'.repeat(100),
  sdsSections,
  tagged,
  similarity: 0.5,
});

describe('BuildProductDocumentContextService.select (documentos del producto)', () => {
  it('de una FDS análoga solo deja los fragmentos de las secciones de medidas que se redactan', () => {
    const selected = BuildProductDocumentContextService.select(
      [
        hit('s1', 'etanol', [9]),
        hit('a1', 'analogo', [9]),
        hit('a2', 'analogo', [14]),
        hit('a3', 'analogo', [], false),
      ],
      [supplier, analogous],
      [9, 14],
      10_000,
    );
    expect(selected.map((f) => f.id)).toEqual(['s1']);
  });

  it('usa el análogo como modelo de redacción de las medidas (primeros auxilios, incendio, derrame…)', () => {
    const selected = BuildProductDocumentContextService.select(
      [hit('a4', 'analogo', [4]), hit('a5', 'analogo', [5]), hit('s4', 'etanol', [4])],
      [analogous, supplier],
      [4, 5, 6],
      10_000,
    );
    // Primero la FDS del proveedor; el análogo al final.
    expect(selected.map((f) => f.id)).toEqual(['s4', 'a4', 'a5']);
  });
});

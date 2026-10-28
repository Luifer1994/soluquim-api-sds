import { ReferenceDocumentChunker } from '@/modules/reference/chunker';

const header = 'Tipo De Documento: Procedimiento\nCódigo: TR-P-01';
const page = (number: number, body: string) => ({ number, text: `${header}\nPágina ${number} de 6\n${body}` });

describe('ReferenceDocumentChunker', () => {
  it('quita encabezados y pies que se repiten en las páginas', () => {
    const topics = ['primeros auxilios', 'incendios', 'derrames', 'almacenamiento', 'protección', 'transporte'];
    // Cuerpo de varias líneas: una tabla que solo cambia en números NO es encabezado.
    const body = (topic: string) =>
      [
        ...Array.from({ length: 8 }, (_, line) => `Contenido sobre ${topic}, párrafo ${line}, con detalle suficiente.`),
        '1170 127',
        '1203 128',
        ...Array.from({ length: 8 }, (_, line) => `Más texto sobre ${topic}, línea ${line}.`),
      ].join('\n');
    const pages = topics.map((topic, i) => page(i + 1, body(topic)));
    const chunks = ReferenceDocumentChunker.chunk(pages);
    const text = chunks.map((c) => c.content).join('\n');
    expect(text).not.toContain('Tipo De Documento');
    expect(text).not.toMatch(/Página \d de 6/);
    expect(text).toContain('Contenido sobre derrames');
    expect(text).toContain('1170 127');
  });

  it('respeta el tamaño objetivo, traslapa los cortes y guarda las páginas de cada fragmento', () => {
    const pages = [1, 2, 3].map((number) => ({
      number,
      text: Array.from(
        { length: 12 },
        (_, i) => `Línea ${i} de la página ${number} con texto de relleno suficiente.`,
      ).join('\n'),
    }));
    const chunks = ReferenceDocumentChunker.chunk(pages, { targetChars: 600, overlapChars: 120 });
    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach((chunk, index) => {
      expect(chunk.position).toBe(index);
      expect(chunk.content.length).toBeLessThanOrEqual(600 + 120);
      expect(chunk.pageFrom).not.toBeNull();
      expect(chunk.pageTo! >= chunk.pageFrom!).toBe(true);
    });
    // El final de un fragmento reaparece al inicio del siguiente.
    const lastLine = chunks[0].content.split('\n').at(-1)!;
    expect(chunks[1].content.split('\n').slice(0, 3)).toContain(lastLine);
    // Ningún fragmento es solo el traslape del anterior.
    chunks.slice(1).forEach((chunk, index) => expect(chunks[index].content.endsWith(chunk.content)).toBe(false));
  });

  it('une palabras cortadas al final de línea (conserva el guion) y parte párrafos larguísimos (Word) sin páginas', () => {
    const paragraph = 'La ficha de datos de seguri-\ndad debe tener dieciséis secciones. '.repeat(80);
    const chunks = ReferenceDocumentChunker.chunk([{ number: null, text: paragraph }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].content).toContain('seguri-dad');
    expect(chunks.every((c) => c.pageFrom === null && c.pageTo === null)).toBe(true);
  });

  it('descarta páginas sin texto útil (índices de números, páginas en blanco)', () => {
    expect(ReferenceDocumentChunker.chunk([{ number: 1, text: '1 2 3 4 5\n\n- - -' }])).toEqual([]);
  });
});

describe('ReferenceDocumentChunker con FDS', () => {
  const body = (topic: string) =>
    Array.from({ length: 4 }, (_, i) => `Texto sobre ${topic}, línea ${i}, con contenido suficiente.`).join('\n');

  it('detecta las secciones ("SECCIÓN N" y "N Título") y corta en cada cambio de sección', () => {
    const pages = [
      {
        number: 1,
        text: `SECCIÓN 1. Identificación\n${body('identificación')}\n2 Identificación de peligros\n${body('peligros')}`,
      },
      {
        number: 2,
        text: `3 Composición/información sobre los componentes\n${body('composición')}\n5 Medidas de lucha contra incendios\n${body('incendio fuera de orden')}`,
      },
      { number: 3, text: `4.1 Descripción de los primeros auxilios\n${body('primeros auxilios')}` },
    ];
    const chunks = ReferenceDocumentChunker.chunk(pages);
    const sectionOf = (topic: string) => chunks.find((c) => c.content.includes(`Texto sobre ${topic}`))!.sdsSections;
    expect(sectionOf('identificación')).toEqual([1]);
    expect(sectionOf('peligros')).toEqual([2]);
    // "5 Medidas…" no es la sección siguiente (3 → 4): no cambia de sección.
    expect(sectionOf('incendio fuera de orden')).toEqual([3]);
    expect(sectionOf('primeros auxilios')).toEqual([4]);
    // Cada fragmento tiene una sola sección: el corte respeta las secciones.
    expect(chunks.every((c) => c.sdsSections.length <= 1)).toBe(true);
  });

  it('un documento que no es FDS no tiene secciones', () => {
    const chunks = ReferenceDocumentChunker.chunk([{ number: 1, text: body('procedimiento general') }]);
    expect(chunks[0].sdsSections).toEqual([]);
  });
});

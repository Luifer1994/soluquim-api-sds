import { SearchKnowledgeService, SearchKnowledgeTool } from '@/modules/knowledge';
import { Result } from '@/shared/util';

describe('SearchKnowledgeTool', () => {
  const hit = {
    id: '1',
    cas: '67-64-1',
    source: 'PUBCHEM',
    title: 'Acetona',
    content: 'Líquido inflamable',
    sdsSections: [2, 9],
    sourceUrl: 'https://pubchem',
    language: 'es',
    similarity: 0.87654,
  };

  it('valida sus argumentos y devuelve los fragmentos compactos, con fuente y similitud redondeada', async () => {
    const execute = jest.fn().mockResolvedValue(Result.success([hit]));
    const tool = new SearchKnowledgeTool({ execute } as unknown as SearchKnowledgeService);

    expect(tool.inputSchema.safeParse({ casList: [], sections: [2] }).success).toBe(false);
    const hits = await tool.execute({ casList: ['67-64-1'], sections: [2] });

    expect(execute).toHaveBeenCalledWith({ casList: ['67-64-1'], sections: [2], query: undefined, perCas: 8 });
    expect(hits).toEqual([
      {
        cas: '67-64-1',
        source: 'PUBCHEM',
        title: 'Acetona',
        sections: [2, 9],
        similarity: 0.877,
        sourceUrl: 'https://pubchem',
        content: 'Líquido inflamable',
      },
    ]);
  });

  it('si la búsqueda falla, lanza el error (el agente lo recibe como resultado de la herramienta)', async () => {
    const execute = jest.fn().mockResolvedValue(Result.failure('INTERNAL_ERROR', 'falló', 500));
    const tool = new SearchKnowledgeTool({ execute } as unknown as SearchKnowledgeService);
    await expect(tool.execute({ casList: ['1-1-1'], sections: [2] })).rejects.toThrow('falló');
  });
});

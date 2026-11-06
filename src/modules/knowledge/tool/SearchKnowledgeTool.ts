import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentTool } from '@/shared/ai';
import { SearchKnowledgeService } from '@/modules/knowledge/service';

const SearchKnowledgeArgs = z.object({
  casList: z.array(z.string().min(2)).min(1).max(20).describe('Números CAS de los componentes a consultar'),
  sections: z
    .array(z.number().int().min(1).max(16))
    .min(1)
    .describe('Secciones de la FDS (1-16) para las que se busca'),
  query: z
    .string()
    .min(3)
    .optional()
    .describe('Qué se busca, en lenguaje natural; sin ella, el contenido típico de esas secciones'),
  perCas: z.number().int().min(1).max(20).optional().describe('Máximo de fragmentos por CAS (por defecto 8)'),
});

type SearchKnowledgeArgs = z.infer<typeof SearchKnowledgeArgs>;

/** Fragmento como lo recibe el agente: lo justo para citarlo (fuente, URL) y usarlo. */
export interface KnowledgeToolHit {
  cas: string | null;
  source: string;
  title: string;
  sections: number[];
  similarity: number | null;
  sourceUrl: string | null;
  content: string;
}

/**
 * La base de conocimiento (RAG) como herramienta de un agente: fragmentos de las fuentes oficiales por CAS, los más
 * relevantes primero (búsqueda semántica; sin IA, por metadatos). Sirve a cualquier agente que necesite datos de
 * sustancias con su fuente, en vez de recibir todo el contexto de entrada.
 */
@Injectable()
export class SearchKnowledgeTool implements AgentTool<SearchKnowledgeArgs, KnowledgeToolHit[]> {
  readonly name = 'search_knowledge';
  readonly description =
    'Busca en la base de conocimiento de sustancias (fuentes oficiales por CAS: PubChem, ECHA, NIOSH…) los ' +
    'fragmentos más relevantes para unas secciones de la FDS. Úsala cuando necesites un dato de un componente y ' +
    'su fuente; cita la fuente de lo que uses. Devuelve fragmentos con CAS, fuente, URL, similitud y texto.';
  readonly inputSchema = SearchKnowledgeArgs;

  constructor(private readonly search: SearchKnowledgeService) {}

  async execute({ casList, sections, query, perCas = 8 }: SearchKnowledgeArgs): Promise<KnowledgeToolHit[]> {
    const result = await this.search.execute({ casList, sections, query, perCas });
    if (!result.isSuccess) throw new Error(result.message);
    return (result.data ?? []).map((hit) => ({
      cas: hit.cas,
      source: hit.source,
      title: hit.title,
      sections: hit.sdsSections,
      similarity: hit.similarity === null ? null : Math.round(hit.similarity * 1000) / 1000,
      sourceUrl: hit.sourceUrl,
      content: hit.content,
    }));
  }
}

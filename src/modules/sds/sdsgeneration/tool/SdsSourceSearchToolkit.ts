import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AgentTool, defineTool } from '@/shared/ai';
import { SearchKnowledgeService } from '@/modules/knowledge';
import {
  BuildProductDocumentContextService,
  BuildReferenceContextService,
  PRODUCT_DOCUMENT_CITATION_SOURCE,
  ProductDocument,
  REFERENCE_CITATION_SOURCE,
} from '@/modules/reference';
import { ProductReferenceQuery } from '@/modules/sds/sdsgeneration/assembler/ProductReferenceQueryBuilder';
import { CitableRefs } from '@/modules/sds/sdsgeneration/tool/CitableRefs';

/** Fragmentos máximos que devuelve una búsqueda. */
const HITS_PER_SEARCH = 6;
/** Caracteres máximos de documentos (referencia o del producto) por búsqueda: lo justo para un dato puntual. */
const DOCUMENT_CHARS_PER_SEARCH = 6000;

/** Sobre qué trabaja un agente que busca: el producto, sus secciones y, si cita, el registro de referencias del grupo. */
export interface SdsSourceSearchScope {
  /** Secciones por defecto de cada búsqueda. */
  sections: number[];
  casList: string[];
  language: string;
  referenceQuery: ProductReferenceQuery;
  /** Documentos del producto adjuntos a la generación (sin ellos no se ofrece su búsqueda). */
  productDocuments: ProductDocument[];
  /** Registro de referencias citables: lo que se encuentre se registra y se devuelve con su referencia. */
  refs?: CitableRefs;
}

const SectionsArg = z
  .array(z.number().int().min(1).max(16))
  .optional()
  .describe('Secciones de la FDS; sin ellas, las de la tarea');

/** Lo que recibe el agente de cada fragmento: corto, con su referencia si cita. */
interface FoundFragment {
  ref?: string;
  source: string;
  title: string;
  cas: string | null;
  content: string;
}

/**
 * Herramientas de búsqueda de las fuentes de una FDS para los agentes (los especialistas que completan campos y los
 * que revisan): la base de conocimiento por CAS, la documentación de referencia (SGA, GRE, procedimientos) y los
 * documentos del producto adjuntos. Se arman por ejecución ({@link forScope}) sobre el producto de esa FDS; si el
 * agente cita, cada fragmento queda en el registro del grupo y su cita se valida igual que el contexto inicial.
 */
@Injectable()
export class SdsSourceSearchToolkit {
  constructor(
    private readonly knowledge: SearchKnowledgeService,
    private readonly references: BuildReferenceContextService,
    private readonly productDocuments: BuildProductDocumentContextService,
  ) {}

  forScope(scope: SdsSourceSearchScope): AgentTool[] {
    return [
      this.searchKnowledge(scope),
      this.searchReferences(scope),
      ...(scope.productDocuments.length ? [this.searchProductDocuments(scope)] : []),
    ];
  }

  private searchKnowledge(scope: SdsSourceSearchScope): AgentTool {
    return defineTool({
      name: 'search_sources',
      description:
        'Busca en la base de conocimiento de sustancias (fuentes oficiales por CAS: PubChem, ECHA, NIOSH, ICSC…) un ' +
        'dato concreto de un componente. Consulta precisa: el dato y la sustancia ("punto de inflamación acetona").',
      inputSchema: z.object({
        query: z.string().min(3).describe('Qué dato se busca y de qué sustancia'),
        cas: z.string().optional().describe('CAS de un solo componente; sin él, en todos'),
        sections: SectionsArg,
      }),
      execute: async ({ query, cas, sections }) => {
        const result = await this.knowledge.execute({
          casList: cas ? [cas] : scope.casList,
          sections: sections?.length ? sections : scope.sections,
          query,
          perCas: HITS_PER_SEARCH,
        });
        if (!result.isSuccess) throw new Error(result.message);
        return (result.data ?? []).slice(0, HITS_PER_SEARCH).map((hit): FoundFragment => ({
          ref: scope.refs?.register('S', hit),
          source: hit.source,
          title: hit.title,
          cas: hit.cas,
          content: hit.content,
        }));
      },
    });
  }

  private searchReferences(scope: SdsSourceSearchScope): AgentTool {
    return defineTool({
      name: 'search_reference_docs',
      description:
        'Busca en la documentación de referencia cargada (SGA/Libro Púrpura, GRE, Reglamentación Modelo de la ONU, ' +
        'procedimientos) lo que establece para este producto: medidas por tipo de peligro, transporte, criterios de ' +
        'clasificación. Úsala cuando un campo depende de una norma y no de un dato de la sustancia.',
      inputSchema: z.object({
        query: z.string().min(3).describe('Qué se busca en la normativa'),
        sections: SectionsArg,
      }),
      execute: async ({ query, sections }) => {
        const wanted = sections?.length ? sections : scope.sections;
        const result = await this.references.execute({
          sections: wanted,
          product: `${scope.referenceQuery.product}. ${query}`,
          identifiers: scope.referenceQuery.identifiers,
          terms: scope.referenceQuery.terms,
          maxChars: DOCUMENT_CHARS_PER_SEARCH,
        });
        if (!result.isSuccess) throw new Error(result.message);
        return (result.data ?? []).slice(0, HITS_PER_SEARCH).map((fragment): FoundFragment => {
          const hit = CitableRefs.fromDocument(fragment, REFERENCE_CITATION_SOURCE, wanted, scope.language);
          return {
            ref: scope.refs?.register('R', hit),
            source: hit.source,
            title: hit.title,
            cas: null,
            content: hit.content,
          };
        });
      },
    });
  }

  private searchProductDocuments(scope: SdsSourceSearchScope): AgentTool {
    return defineTool({
      name: 'search_product_documents',
      description:
        'Busca en los documentos del producto adjuntos a esta FDS (FDS del proveedor de cada materia prima, de ' +
        'productos análogos, datos del producto final). Úsala para datos propios del producto o de una materia prima.',
      inputSchema: z.object({ query: z.string().min(3).describe('Qué dato se busca'), sections: SectionsArg }),
      execute: async ({ query, sections }) => {
        const wanted = sections?.length ? sections : scope.sections;
        const result = await this.productDocuments.execute({
          documents: scope.productDocuments,
          sections: wanted,
          product: `${scope.referenceQuery.product}. ${query}`,
          maxChars: DOCUMENT_CHARS_PER_SEARCH,
        });
        if (!result.isSuccess) throw new Error(result.message);
        return (result.data ?? []).slice(0, HITS_PER_SEARCH).map((fragment): FoundFragment => {
          const hit = CitableRefs.fromDocument(fragment, PRODUCT_DOCUMENT_CITATION_SOURCE, wanted, scope.language);
          return {
            ref: scope.refs?.register('D', hit),
            source: hit.source,
            title: hit.title,
            cas: hit.cas,
            content: hit.content,
          };
        });
      },
    });
  }
}

import { AgentSettings, FINAL_ANSWER_TOOL, LlmProvider, LlmRequest, LlmResponse } from '@/shared/ai';
import { AppConfig, parseEnv } from '@/shared/config';
import { Result } from '@/shared/util';
import { KnowledgeSearchHit, SdsSectionCatalog, SearchKnowledgeService } from '@/modules/knowledge';
import { BuildProductDocumentContextService, BuildReferenceContextService } from '@/modules/reference';
import { SdsGapFillingAgent, SdsSpecialistProfiles } from '@/modules/sds/sdsgeneration/agent';
import { CitableRefs, SdsSourceSearchToolkit } from '@/modules/sds/sdsgeneration/tool';

const settings = (env: Record<string, string> = {}) =>
  new AgentSettings(
    new AppConfig(parseEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d', RABBITMQ_URL: 'amqp://u:p@h:5672', ...env })),
  );

const hit = (id: string, content: string): KnowledgeSearchHit => ({
  id,
  cas: '67-64-1',
  source: 'PUBCHEM',
  title: 'Acetona',
  content,
  sdsSections: [9],
  sourceUrl: null,
  language: 'en',
  similarity: 0.9,
});

function scriptedLlm(...turns: LlmResponse[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: 'fake',
    requests,
    complete: (request) => {
      requests.push({ ...request, messages: [...request.messages] });
      return Promise.resolve(turns.shift()!);
    },
  };
}
const usage = { promptTokens: 10, completionTokens: 5 };
const calls = (...items: Array<[string, unknown]>): LlmResponse => ({
  content: '',
  model: 'm',
  usage,
  toolCalls: items.map(([name, args], i) => ({ id: `${name}-${i}`, name, arguments: JSON.stringify(args) })),
});

function toolkit(knowledge: jest.Mock, references: jest.Mock = jest.fn().mockResolvedValue(Result.success([]))) {
  return new SdsSourceSearchToolkit(
    { execute: knowledge } as unknown as SearchKnowledgeService,
    { execute: references } as unknown as BuildReferenceContextService,
    { execute: jest.fn() } as unknown as BuildProductDocumentContextService,
  );
}

describe('SdsGapFillingAgent (2.ª pasada con búsqueda dirigida)', () => {
  const sections = [SdsSectionCatalog.forProduct(9, 'substance')];
  const drafting = {
    language: 'es',
    components: [{ cas: '67-64-1', name: 'Acetona', percentage: 100 }],
    sections,
    knowledge: [],
    specialist: SdsSpecialistProfiles.forSections([9]),
    review: true,
  };
  const field = sections[0].subsections[0].fields[0].key;
  const scope = (refs: CitableRefs) => ({
    sections: [9],
    casList: ['67-64-1'],
    language: 'es',
    referenceQuery: { product: 'SUSTANCIA: Acetona (CAS 67-64-1)', identifiers: ['67-64-1'], terms: ['H225'] },
    productDocuments: [],
    refs,
  });

  it('busca en las fuentes, registra lo nuevo como S…/R… del grupo y entrega el JSON del redactor', async () => {
    const knowledge = jest
      .fn()
      .mockResolvedValueOnce(Result.success([hit('k1', 'Flash point -20 °C'), hit('known', 'ya estaba')]))
      .mockResolvedValueOnce(Result.success([hit('k1', 'Flash point -20 °C')]));
    const references = jest
      .fn()
      .mockResolvedValue(
        Result.success([
          { id: 'gre', citationTitle: 'GRE 2024 · p. 155', content: 'Guía 127', similarity: 0.7, language: 'es' },
        ]),
      );
    const llm = scriptedLlm(
      calls(
        ['search_sources', { query: 'punto de inflamación acetona' }],
        ['search_reference_docs', { query: 'guía GRE' }],
      ),
      calls(['search_sources', { query: 'flash point acetone', cas: '67-64-1', sections: [9] }]),
      calls([
        FINAL_ANSWER_TOOL,
        {
          sections: [
            {
              number: 9,
              fields: [{ key: field, value: '-20 °C', sourceRefs: ['S1'] }],
              conflicts: [],
              confidence: 'high',
            },
          ],
        },
      ]),
    );
    const refs = new CitableRefs(
      new Map([
        ['K1', hit('known', 'ya estaba')],
        ['R1', hit('ref-1', 'SGA')],
      ]),
    );
    const agent = new SdsGapFillingAgent(llm, settings());

    const result = await agent.run({ drafting, tools: toolkit(knowledge, references).forScope(scope(refs)) });

    expect(result.output.sections[0].fields[0]).toMatchObject({ value: '-20 °C', sourceRefs: ['S1'] });
    // Lo nuevo continúa la numeración de su tipo; lo que ya estaba conserva su referencia y no se duplica.
    expect([...refs.map.keys()]).toEqual(['K1', 'R1', 'S1', 'R2']);
    expect(refs.map.get('R2')).toMatchObject({ source: 'REFERENCE', title: 'GRE 2024 · p. 155' });
    expect(knowledge).toHaveBeenNthCalledWith(1, {
      casList: ['67-64-1'],
      sections: [9],
      query: 'punto de inflamación acetona',
      perCas: 6,
    });
    const toolMessages = llm.requests[1].messages.filter((m) => m.role === 'tool');
    expect((JSON.parse(toolMessages[0].content) as Array<{ ref: string }>).map((r) => r.ref)).toEqual(['S1', 'K1']);
    // Prompt: el de revisión del especialista + el bloque de búsqueda; sin documentos del producto no se ofrece su búsqueda.
    expect(llm.requests[0].messages[0].content).toContain('SEGUNDA REVISIÓN');
    expect(llm.requests[0].messages[0].content).toContain('BÚSQUEDA DIRIGIDA');
    expect(llm.requests[0].tools?.map((t) => t.name)).toEqual([
      'search_sources',
      'search_reference_docs',
      FINAL_ANSWER_TOOL,
    ]);
  });

  it('usa el modelo del redactor salvo que tenga uno propio (AI_AGENT_MODELS=sds-gap-filling=…)', () => {
    expect(new SdsGapFillingAgent(scriptedLlm(), settings({ AI_AGENT_MODELS: 'sds-section-drafting=a/b' })).model).toBe(
      'a/b',
    );
    expect(new SdsGapFillingAgent(scriptedLlm(), settings({ AI_AGENT_MODELS: 'sds-gap-filling=c/d' })).model).toBe(
      'c/d',
    );
  });
});

import { AgentSettings, FINAL_ANSWER_TOOL, LlmProvider, LlmRequest, LlmResponse } from '@/shared/ai';
import { AppConfig, parseEnv } from '@/shared/config';
import { Result } from '@/shared/util';
import { SearchKnowledgeService } from '@/modules/knowledge';
import { BuildProductDocumentContextService, BuildReferenceContextService } from '@/modules/reference';
import { SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument';
import { SdsDraftDigest, SdsQualityReviewAgent, SdsSpecialistReviewAgent } from '@/modules/sds/sdsgeneration/agent';
import { QualityIssueApplier } from '@/modules/sds/sdsgeneration/assembler';
import { SdsSourceSearchToolkit } from '@/modules/sds/sdsgeneration/tool';

const settings = new AgentSettings(
  new AppConfig(parseEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d', RABBITMQ_URL: 'amqp://u:p@h:5672' })),
);

const section = (fields: Array<[string, string | null]>): SdsSectionSuggestionDTO => ({
  subsections: [
    {
      code: 'x',
      title: 'x',
      fields: fields.map(([label, value], i) => ({
        key: `k${i}`,
        label,
        value,
        origin: 'agent',
        citations: [],
        kind: 'text',
      })),
    },
  ],
  content: '',
  missingData: [],
  conflicts: [],
  confidence: 'medium',
  invalidRefs: [],
  discarded: [],
});

const suggestions = new Map<number, SdsSectionSuggestionDTO>([
  [2, section([['Clasificación', 'Líquido inflamable, categoría 2']])],
  [
    9,
    section([
      ['Punto de inflamación', '80 °C'],
      ['Densidad', null],
    ]),
  ],
  [14, section([['Clase de transporte', '3']])],
]);

/** LLM con guion por agente (el nombre del agente va en el schema de la herramienta final). */
function scriptedLlm(script: Record<string, LlmResponse[]>): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: 'fake',
    requests,
    complete: (request) => {
      requests.push({ ...request, messages: [...request.messages] });
      const lead = request.tools?.some((tool) => tool.name.startsWith('consult_'));
      const next = script[lead ? 'lead' : 'specialist'].shift();
      if (!next) throw new Error('sin guion');
      return Promise.resolve(next);
    },
  };
}
const usage = { promptTokens: 10, completionTokens: 5 };
const call = (name: string, args: unknown, id: string): LlmResponse => ({
  content: '',
  model: 'm',
  usage,
  toolCalls: [{ id, name, arguments: JSON.stringify(args) }],
});

describe('SdsQualityReviewAgent (orquestador con especialistas como subagentes)', () => {
  it('delega la duda en el especialista, que verifica con el RAG, y entrega el problema confirmado', async () => {
    const search = jest.fn().mockResolvedValue(
      Result.success([
        {
          id: '1',
          cas: '67-64-1',
          source: 'PUBCHEM',
          title: 'Acetona',
          content: 'Flash point -20 °C',
          sdsSections: [9],
          sourceUrl: null,
          language: 'en',
          similarity: 0.9,
        },
      ]),
    );
    const tools = new SdsSourceSearchToolkit(
      { execute: search } as unknown as SearchKnowledgeService,
      { execute: jest.fn().mockResolvedValue(Result.success([])) } as unknown as BuildReferenceContextService,
      { execute: jest.fn() } as unknown as BuildProductDocumentContextService,
    ).forScope({
      sections: [2, 9, 14],
      casList: ['67-64-1'],
      language: 'es',
      referenceQuery: { product: 'Acetona', identifiers: ['67-64-1'], terms: [] },
      productDocuments: [],
    });
    const llm = scriptedLlm({
      lead: [
        call(
          'consult_physical_chemistry',
          {
            question: '¿Es correcto un punto de inflamación de 80 °C si la sección 2 dice inflamable cat. 2?',
            sections: [2],
          },
          'l1',
        ),
        call(
          FINAL_ANSWER_TOOL,
          {
            issues: [
              {
                section: 9,
                field: 'Punto de inflamación',
                problem: 'Contradice inflamable cat. 2',
                suggestion: '-20 °C',
                relatedSections: [2],
                severity: 'high',
              },
            ],
          },
          'l2',
        ),
      ],
      specialist: [
        call('search_sources', { query: 'punto de inflamación acetona', cas: '67-64-1', sections: [9] }, 's1'),
        call(
          FINAL_ANSWER_TOOL,
          {
            verdict: 'inconsistent',
            correctedValue: '-20 °C',
            rationale: 'PubChem: -20 °C',
            sources: ['67-64-1:PUBCHEM'],
          },
          's2',
        ),
      ],
    });
    const lead = new SdsQualityReviewAgent(llm, settings, new SdsSpecialistReviewAgent(llm, settings));

    const result = await lead.run({
      language: 'es',
      productKind: 'substance',
      components: [{ cas: '67-64-1', name: 'Acetona', concentration: '100 %' }],
      suggestions,
      tools,
    });

    expect(result.output.issues).toHaveLength(1);
    // El líder ve toda la ficha (solo campos con valor) y tiene un especialista por perfil + el RAG.
    const leadRequest = llm.requests[0];
    expect(leadRequest.messages[1].content).toContain('- Punto de inflamación: 80 °C');
    expect(leadRequest.messages[1].content).not.toContain('Densidad');
    expect(leadRequest.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'consult_classification',
        'consult_physical_chemistry',
        'consult_waste_transport',
        'search_sources',
        FINAL_ANSWER_TOOL,
      ]),
    );
    // El especialista recibe SUS secciones (9, 10) más la que pidió el líder (2), y la pregunta.
    const specialistRequest = llm.requests[1];
    expect(specialistRequest.messages[0].content).toContain('Químico especialista en propiedades fisicoquímicas');
    expect(specialistRequest.messages[1].content).toContain('## 2. ');
    expect(specialistRequest.messages[1].content).toContain('## 9. ');
    expect(specialistRequest.messages[1].content).not.toContain('## 14. ');
    expect(search).toHaveBeenCalledWith({
      casList: ['67-64-1'],
      sections: [9],
      query: 'punto de inflamación acetona',
      perCas: 6,
    });
    // Al líder le vuelve SOLO la opinión del especialista.
    const toLead = llm.requests[3].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toLead!.content)).toEqual({
      verdict: 'inconsistent',
      correctedValue: '-20 °C',
      rationale: 'PubChem: -20 °C',
      sources: ['67-64-1:PUBCHEM'],
    });
    // Uso total: 2 llamadas del líder + 2 del especialista; traza con niveles.
    expect(result.usage.promptTokens).toBe(40);
    expect(result.trace?.map((e) => `${e.depth}:${e.kind}:${e.name}`)).toEqual([
      '0:llm:sds-quality-review',
      '1:llm:sds-specialist-review',
      '1:tool:search_sources',
      '1:llm:sds-specialist-review',
      '0:tool:consult_physical_chemistry',
      '0:llm:sds-quality-review',
    ]);
  });
});

describe('SdsDraftDigest y QualityIssueApplier', () => {
  it('el resumen lleva solo campos con valor, por sección y en orden', () => {
    expect(SdsDraftDigest.render(suggestions, [14, 9])).toBe(
      '## 9. Propiedades físicas y químicas\n- Punto de inflamación: 80 °C\n\n## 14. Información relativa al transporte\n- Clase de transporte: 3',
    );
    expect(SdsDraftDigest.valueOf(suggestions, 9, 'punto de inflamación')).toBe('80 °C');
  });

  it('cada problema queda como conflicto de su sección, sin tocar las recibidas; los de secciones sin sugerencia se ignoran', () => {
    const issues = [
      {
        section: 9,
        field: 'Punto de inflamación',
        problem: 'No cuadra',
        suggestion: null,
        relatedSections: [9, 2],
        severity: 'medium' as const,
      },
      { section: 5, field: 'X', problem: 'Y', suggestion: null, relatedSections: [], severity: 'low' as const },
    ];
    const result = QualityIssueApplier.apply(suggestions, issues);

    expect(result.get(9)?.conflicts).toEqual([
      {
        field: 'Punto de inflamación',
        chosen: '80 °C',
        alternatives: [],
        reason: 'Revisión de coherencia (prioridad media): No cuadra (ver secciones 2)',
      },
    ]);
    expect(suggestions.get(9)?.conflicts).toEqual([]);
    expect(result.has(5)).toBe(false);
  });
});

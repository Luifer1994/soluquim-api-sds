import { AgentSettings, LlmProvider, LlmRequest } from '@/shared/ai';
import { AppConfig, parseEnv } from '@/shared/config';
import { Result } from '@/shared/util';
import {
  BuildSectionContextService,
  SdsSectionCatalog,
  SectionContextFragment,
  SyncSubstanceKnowledgeService,
} from '@/modules/knowledge';
import { ListCurrentSourceDataService } from '@/modules/substance';
import { CreateSdsDocumentDraftService, SdsDocumentContentDTO } from '@/modules/sds/sdsdocument';
import { SdsSectionDraftingAgent } from '@/modules/sds/sdsgeneration/agent';
import { SdsGenerationJobRepository } from '@/modules/sds/sdsgeneration/repository';
import { RunSdsGenerationService } from '@/modules/sds/sdsgeneration/service';

const CAS = '64-17-5';
const hit = (source: string, sections: number[]): SectionContextFragment => ({
  id: `${source}-id`,
  cas: CAS,
  source,
  title: `${source} · Ethanol`,
  content: 'Fuente: … datos …',
  sdsSections: sections,
  sourceUrl: 'https://example.org',
  language: 'es',
  similarity: 0.9,
  chunkKey: 'firstAid',
  tagged: true,
  relevance: 'section',
});

/**
 * LLM falso: por cada sección pedida llena el 1.er campo de la plantilla citando K1 (válida) y K99
 * (inventada), el 2.º sin cita, y agrega un campo que no existe en la plantilla.
 */
function fakeLlm(failOn?: string): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: 'fake',
    requests,
    complete: (request) => {
      requests.push(request);
      const user = request.messages.at(-1)!.content;
      if (failOn && user.includes(failOn)) return Promise.reject(new Error('LLM caído'));
      // Las secciones y sus campos se leen de la plantilla que viene en el prompt (en la revisión es reducida).
      const template = user.slice(user.indexOf('<template>'), user.indexOf('</template>'));
      const blocks = template.split(/^(?=SECCIÓN \d+\. )/m).filter((block) => block.startsWith('SECCIÓN'));
      const sections = blocks.map((block) => {
        const number = Number(/^SECCIÓN (\d+)\. /.exec(block)![1]);
        const keys = [...block.matchAll(/- key "([^"]+)"/g)].map((m) => m[1]);
        return {
          number,
          fields: [
            { key: keys[0], value: `Dato de la sección ${number}`, sourceRefs: ['K1', 'K99'] },
            { key: keys[1], value: 'Dato sin respaldo', sourceRefs: [] },
            { key: 'empresaInventada', value: 'ACME S.A.', sourceRefs: ['K1'] },
          ].filter((field) => field.key),
          conflicts: [],
          confidence: 'medium',
        };
      });
      return Promise.resolve({
        content: JSON.stringify({ sections }),
        model: 'fake/model',
        usage: { promptTokens: 100, completionTokens: 50, cost: 0.01 },
      });
    },
  };
}

function setup(llm: LlmProvider) {
  const config = new AppConfig(
    parseEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d', RABBITMQ_URL: 'amqp://u:p@h:5672' }),
  );
  const job = {
    id: 'job-1',
    tenantId: 'default',
    mixtureKey: 'k'.repeat(64),
    requestedBy: null,
    request: {
      components: [
        { cas: CAS, percentage: 70 },
        { cas: '7732-18-5', percentage: 30 },
      ],
      language: 'es',
      product: { name: 'Alcohol 70 %' },
    },
  };
  const jobs = {
    claim: jest.fn().mockResolvedValue(job),
    progress: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
  } as unknown as SdsGenerationJobRepository & Record<'claim' | 'progress' | 'complete' | 'fail', jest.Mock>;
  const sync = {
    execute: jest
      .fn()
      .mockResolvedValue(
        Result.success([{ cas: CAS, sources: { OK: 2 }, changedSources: [], knowledge: null, errors: [] }]),
      ),
  } as unknown as SyncSubstanceKnowledgeService & { execute: jest.Mock };
  const current = {
    execute: jest.fn(({ cas }: { cas: string }) =>
      Promise.resolve(
        Result.success({
          cas,
          substanceName: cas === CAS ? 'Ethanol' : 'Water',
          sources: [
            {
              source: 'ICSC',
              status: 'OK',
              version: 1,
              sourceUrl: 'u',
              records: [
                {
                  field: 'firstAid.byRoute',
                  label: 'Primeros auxilios',
                  value: { inhalation: 'Aire limpio' },
                  sourceUrl: 'u',
                },
                { field: 'meta.language', label: 'Idioma', value: 'es', sourceUrl: 'u' },
              ],
            },
          ],
        }),
      ),
    ),
  } as unknown as ListCurrentSourceDataService;
  const search = {
    execute: jest.fn(({ sections }: { sections: number[] }) =>
      Promise.resolve(Result.success([hit('ICSC', sections)])),
    ),
  } as unknown as BuildSectionContextService & { execute: jest.Mock };
  const createDraft = {
    execute: jest.fn((data: { content: SdsDocumentContentDTO }) =>
      Promise.resolve(Result.created({ id: 'doc-1', ...data })),
    ),
  } as unknown as CreateSdsDocumentDraftService & { execute: jest.Mock };
  const agent = new SdsSectionDraftingAgent(llm, new AgentSettings(config));
  return {
    service: new RunSdsGenerationService(jobs, sync, current, search, agent, createDraft),
    jobs,
    sync,
    search,
    createDraft,
  };
}

const contentOf = (createDraft: { execute: jest.Mock }) =>
  (createDraft.execute.mock.calls[0][0] as { content: SdsDocumentContentDTO }).content;
const fieldsOf = (section: SdsDocumentContentDTO['sections'][number]) =>
  section.suggestion!.subsections.flatMap((sub) => sub.fields);

describe('RunSdsGenerationService (flujo completo con LLM falso)', () => {
  it('genera las 16 secciones con la plantilla: 2 a 14 con el agente; 1, 15 y 16 sin IA', async () => {
    const llm = fakeLlm();
    const { service, jobs, sync, search, createDraft } = setup(llm);

    const result = await service.execute({ jobId: 'job-1' });

    expect(result.data).toEqual({ documentId: 'doc-1' });
    expect(sync.execute).toHaveBeenCalledWith({ casList: [CAS, '7732-18-5'], runBackgroundSources: true });
    expect(search.execute).toHaveBeenCalledTimes(6); // 6 grupos de secciones
    expect(llm.requests).toHaveLength(12); // 6 especialidades × (1.ª pasada + revisión de campos vacíos)
    const asked = llm.requests.flatMap((r) =>
      [...r.messages.at(-1)!.content.matchAll(/^SECCIÓN (\d+)\. /gm)].map((m) => Number(m[1])),
    );
    expect([...new Set(asked)].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);

    const content = contentOf(createDraft);
    expect(content.sections.map((s) => s.number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(content.sections.map((s) => s.filledBy)).toEqual([
      'request',
      ...Array<string>(13).fill('agent'),
      'sources',
      'system',
    ]);
    for (const section of content.sections) {
      const template = SdsSectionCatalog.forProduct(section.number, 'mixture');
      expect(fieldsOf(section).map((f) => f.key)).toEqual(
        template.subsections.flatMap((sub) => sub.fields.map((f) => f.key)),
      );
    }
    expect(content.isMixture).toBe(true);
    expect(content.components).toEqual([
      { cas: CAS, name: 'Ethanol', percentage: 70 },
      { cas: '7732-18-5', name: 'Water', percentage: 30 },
    ]);
    expect(jobs.complete).toHaveBeenCalledWith(
      'job-1',
      'doc-1',
      'COMPLETED',
      expect.objectContaining({ sectionsWithSuggestion: 16 }),
    );
  });

  it('sección 1: solo nombre y CAS del producto, de la solicitud; el agente no la toca', async () => {
    const llm = fakeLlm();
    const { service, createDraft } = setup(llm);
    await service.execute({ jobId: 'job-1' });

    const fields = new Map(fieldsOf(contentOf(createDraft).sections[0]).map((f) => [f.key, f]));
    expect(fields.get('productName')).toMatchObject({ value: 'Alcohol 70 %', origin: 'request' });
    expect(fields.get('casNumber')!.value).toBeNull(); // mezcla sin CAS propio
    expect([...fields.keys()]).toEqual(['productName', 'casNumber']);
    expect(JSON.stringify(contentOf(createDraft))).not.toContain('ACME');
  });

  it('las citas se verifican: con cita válida entra, sin cita se descarta, K99 (inventada) se informa', async () => {
    const { service, createDraft } = setup(fakeLlm());
    await service.execute({ jobId: 'job-1' });

    const section4 = contentOf(createDraft).sections[3];
    const [first, second] = fieldsOf(section4);
    expect(first).toMatchObject({ value: 'Dato de la sección 4', origin: 'agent' });
    expect(first.citations).toEqual([expect.objectContaining({ ref: 'K1', source: 'ICSC', cas: CAS })]);
    // El valor sin cita de la 1.ª pasada se descarta; la revisión de campos vacíos lo llena, ya citado.
    expect(second).toMatchObject({ value: 'Dato de la sección 4', origin: 'agent' });
    expect(second.citations.map((c) => c.ref)).toEqual(['K1']);
    expect(section4.suggestion!.discarded.map((d) => d.value)).toEqual(['Dato sin respaldo']);
    expect(section4.suggestion!.invalidRefs).toEqual(['K99']);
  });

  it('cada sección trae lo que encontró cada fuente (sin IA), sin los meta.*', async () => {
    const { service, createDraft } = setup(fakeLlm());
    await service.execute({ jobId: 'job-1' });

    const sections = contentOf(createDraft).sections;
    expect(sections[3].bySource).toHaveLength(2); // primeros auxilios: ICSC de cada componente
    expect(sections[3].bySource[0]).toMatchObject({ cas: CAS, source: 'ICSC', componentName: 'Ethanol' });
    expect(sections[3].bySource[0].records.map((r) => r.field)).toEqual(['firstAid.byRoute']);
    expect(sections[8].bySource).toEqual([]); // sección 9: esta fuente no aporta
  });

  it('el prompt lleva la plantilla, los componentes con % y los fragmentos; nunca los datos de la empresa', async () => {
    const llm = fakeLlm();
    await setup(llm).service.execute({ jobId: 'job-1' });

    const request = llm.requests.find((r) => r.messages.at(-1)!.content.includes('SECCIÓN 4. '))!;
    const user = request.messages.at(-1)!.content;
    expect(request.messages[0].content).toContain('Especialista en respuesta a emergencias químicas');
    expect(user).toContain('MEZCLA de 2 componentes');
    expect(user).toContain('Ethanol (CAS 64-17-5): 70 %');
    expect(user).toContain('[K1] [principal] ICSC · Ethanol');
    expect(user).toMatch(/SECCIÓN 4\. .*\n {2}4\.1 /);
    expect(user).toContain('- key "');
    expect(llm.requests.every((r) => !/SECCIÓN (1|15|16)\. /.test(r.messages.at(-1)!.content))).toBe(true);
  });

  it('si un grupo falla, la FDS sale PARTIAL con las demás secciones y el error registrado', async () => {
    const { service, jobs, createDraft } = setup(fakeLlm('SECCIÓN 4. '));
    await service.execute({ jobId: 'job-1' });

    const content = contentOf(createDraft);
    // El agente no redactó la sección 4, pero lo que las fuentes traen tal cual igual entra (sin IA).
    expect(
      fieldsOf(content.sections[3])
        .filter((f) => f.value)
        .map((f) => f.origin),
    ).toEqual(['source']);
    expect(content.sections[4].suggestion).toBeNull(); // sección 5: ni agente ni fuentes
    expect(content.sections[3].bySource.length).toBeGreaterThan(0);
    expect(content.sections[1].suggestion).not.toBeNull();
    expect(content.generation.errors[0]).toMatch(/Secciones 4, 5, 6: LLM caído/);
    expect(jobs.complete).toHaveBeenCalledWith('job-1', 'doc-1', 'PARTIAL', expect.anything());
  });

  it('mensaje repetido: si el job ya fue tomado, no hace nada (idempotente)', async () => {
    const llm = fakeLlm();
    const { service, jobs } = setup(llm);
    jobs.claim.mockResolvedValueOnce(null);

    await service.execute({ jobId: 'job-1' });
    expect(llm.requests).toHaveLength(0);
  });
});

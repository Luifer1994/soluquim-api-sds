import { Injectable } from '@nestjs/common';
import { SdsGenerationStatus } from '@prisma/client';
import { LlmUsage } from '@/shared/ai';
import { BaseService } from '@/shared/base';
import { Result, withDeadline } from '@/shared/util';
import {
  BuildSectionContextService,
  KnowledgeSearchHit,
  SdsProductKind,
  SdsSectionCatalog,
  SdsSectionDefinition,
  SyncSubstanceKnowledgeService,
} from '@/modules/knowledge';
import { CurrentSourceData, ListCurrentSourceDataService } from '@/modules/substance';
import {
  CreateSdsDocumentDraftService,
  SdsDocumentContentDTO,
  SdsSectionSuggestionDTO,
} from '@/modules/sds/sdsdocument';
import { SdsSectionDraft, SdsSectionDraftingAgent, SdsSpecialistProfiles } from '@/modules/sds/sdsgeneration/agent';
import {
  ClassificationEndpointFiller,
  ComponentHazardProfile,
  DeterministicSectionBuilder,
  DraftCleanup,
  GapReviewPlanner,
  RegulatorySectionBuilder,
  SectionEvidenceCollector,
  SectionSuggestionBuilder,
  SourceFallbackFiller,
} from '@/modules/sds/sdsgeneration/assembler';
import { GenerateSdsRequestDTO } from '@/modules/sds/sdsgeneration/dto/request';
import { SdsGenerationJobRepository } from '@/modules/sds/sdsgeneration/repository';

/**
 * Secciones que redacta el agente, agrupadas por especialidad (una llamada por especialista, en paralelo):
 * cada una recibe el conocimiento de TODAS las fuentes, priorizado por relevancia para sus secciones.
 */
const SECTION_GROUPS: number[][] = SdsSpecialistProfiles.all().map((profile) => profile.sections);

/** Secciones donde sí cuentan todos los componentes, también los no peligrosos. */
const COMPOSITION_SECTIONS = [2, 3];

/** Tiempo máximo para redactar un grupo (sus dos pasadas). Pasado ese tiempo el grupo falla y la FDS sigue. */
const GROUP_DEADLINE_MS = 240_000;

interface GroupResult {
  suggestions: Map<number, SdsSectionSuggestionDTO>;
  usage: LlmUsage;
  model?: string;
  fragments: number;
  error?: string;
}

/**
 * Worker: genera el BORRADOR de la FDS de un job.
 *  1-2. SyncSubstanceKnowledgeService: datos de cada componente (la BD primero, las fuentes si falta o
 *       venció; versionado si cambió) y base de conocimiento al día (solo vectoriza lo nuevo).
 *  3. Por cada especialidad (grupo de secciones): contexto completo del RAG (priorizado) + agente redactor,
 *     y una 2.ª pasada solo sobre los campos que quedaron vacíos.
 *  4. Armado de las 16 secciones con la PLANTILLA: 1, 15 y 16 sin IA (solicitud, fuentes y sistema); 2 a
 *     14 con los campos que llenó el agente (citas verificadas, valores sin cita descartados) + lo que trajo cada fuente.
 * Un grupo que falla no tumba la FDS: esas secciones quedan sin sugerencia y el job termina PARTIAL.
 */
@Injectable()
export class RunSdsGenerationService extends BaseService<{ jobId: string }, { documentId: string } | null> {
  constructor(
    private readonly jobs: SdsGenerationJobRepository,
    private readonly syncKnowledge: SyncSubstanceKnowledgeService,
    private readonly currentData: ListCurrentSourceDataService,
    private readonly buildContext: BuildSectionContextService,
    private readonly agent: SdsSectionDraftingAgent,
    private readonly createDraft: CreateSdsDocumentDraftService,
  ) {
    super();
  }

  async execute({ jobId }: { jobId: string }): Promise<Result<{ documentId: string } | null>> {
    const job = await this.jobs.claim(jobId);
    if (!job) return Result.success(null, 'El job ya se estaba procesando o terminó'); // reentrega del mensaje

    const startedAt = Date.now();
    const request = job.request as unknown as GenerateSdsRequestDTO;
    const casList = request.components.map((c) => c.cas);

    try {
      // 1+2. Datos de las fuentes (BD primero) + base de conocimiento al día — el mismo servicio que usará el cron.
      const synced = await this.syncKnowledge.execute({ casList, runBackgroundSources: true });
      if (!synced.isSuccess) throw new Error(synced.message);
      const indexErrors = (synced.data ?? []).flatMap((s) => s.errors);
      await this.jobs.progress(jobId, SdsGenerationStatus.EXTRACTING, {
        step: 'knowledge',
        components: casList.length,
        changedSources: (synced.data ?? []).flatMap((s) => s.changedSources.map((source) => `${s.cas}:${source}`)),
      });

      const current = (await Promise.all(casList.map((cas) => this.currentData.execute({ cas }))))
        .map((r) => r.data)
        .filter((data): data is CurrentSourceData => Boolean(data));
      const names = new Map(current.map((c) => [c.cas, c.substanceName]));
      const components = request.components.map((c) => ({
        cas: c.cas,
        name: names.get(c.cas) ?? null,
        percentage: c.percentage,
      }));

      // 3. Agente por grupo de secciones
      await this.jobs.progress(jobId, SdsGenerationStatus.DRAFTING, {
        step: 'drafting',
        groups: SECTION_GROUPS.length,
      });
      const productKind: SdsProductKind = components.length > 1 ? 'mixture' : 'substance';
      // Diluyentes sin clasificación de peligro (agua): solo cuentan para identificación y composición.
      const inert = new Set(current.filter((c) => ComponentHazardProfile.isInert(c)).map((c) => c.cas));
      const groups = await Promise.all(
        SECTION_GROUPS.map((sections) => this.draftGroup(sections, request, components, productKind, inert)),
      );

      // 4. Armado. Las secciones 1, 15 y 16 NO pasan por la IA: salen de la solicitud, de las fuentes y del sistema.
      const generatedAt = new Date();
      // Lo que el agente dejó vacío (o no pudo redactar) y las fuentes sí traen tal cual, se llena con la
      // fuente; y en la sección 11, cada clase de peligro vacía dice lo que establece la clasificación armonizada.
      const drafted = new Map(groups.flatMap((g) => [...g.suggestions]));
      const suggestions = new Map<number, SdsSectionSuggestionDTO>();
      for (const number of SECTION_GROUPS.flat()) {
        const context = { number, components: current, productKind, language: request.language };
        const suggestion = ClassificationEndpointFiller.fill({
          ...context,
          suggestion: SourceFallbackFiller.fill({ ...context, suggestion: drafted.get(number) ?? null }),
        });
        if (suggestion) suggestions.set(number, suggestion);
      }
      suggestions.set(1, DeterministicSectionBuilder.section1(request, productKind));
      suggestions.set(
        15,
        RegulatorySectionBuilder.section15(
          // Los diluyentes sin clasificación de peligro no aportan reglamentación específica.
          current.some((c) => !inert.has(c.cas)) ? current.filter((c) => !inert.has(c.cas)) : current,
          productKind,
          request.language,
        ),
      );
      suggestions.set(
        16,
        DeterministicSectionBuilder.section16({
          generatedAt,
          language: request.language,
          productKind,
          components: current,
          sections: suggestions,
        }),
      );
      const errors = [...indexErrors, ...groups.flatMap((g) => (g.error ? [g.error] : []))];
      const usage = groups.reduce(
        (acc, g) => ({
          promptTokens: acc.promptTokens + g.usage.promptTokens,
          completionTokens: acc.completionTokens + g.usage.completionTokens,
          cost: (acc.cost ?? 0) + (g.usage.cost ?? 0),
        }),
        { promptTokens: 0, completionTokens: 0, cost: 0 } as LlmUsage,
      );

      const content: SdsDocumentContentDTO = {
        generatedAt: generatedAt.toISOString(),
        language: request.language,
        destinationCountry: request.destinationCountry,
        product: { name: request.product?.name ?? null, cas: request.product?.cas ?? null },
        components,
        isMixture: productKind === 'mixture',
        sections: SdsSectionCatalog.all().map((section) => ({
          number: section.number,
          title: section.title,
          filledBy: section.filledBy,
          suggestion: suggestions.get(section.number) ?? null,
          bySource: SectionEvidenceCollector.collect(current, section.number),
        })),
        generation: {
          agent: this.agent.name,
          promptVersion: this.agent.promptVersion,
          model: groups.find((g) => g.model)?.model ?? this.agent.model,
          usage: {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            costUsd: usage.cost || undefined,
          },
          durationMs: Date.now() - startedAt,
          knowledgeFragments: groups.reduce((sum, g) => sum + g.fragments, 0),
          errors,
        },
      };

      const document = await this.createDraft.execute({
        tenantId: job.tenantId,
        productId: request.product?.productId,
        mixtureKey: job.mixtureKey,
        countryCode: request.destinationCountry,
        language: request.language,
        content,
        provenance: Object.fromEntries(
          content.sections.map((s) => [
            s.number,
            [
              ...new Set(
                s.suggestion?.subsections.flatMap((sub) =>
                  sub.fields.flatMap((f) => f.citations.map((c) => `${c.source}:${c.cas}`)),
                ),
              ),
            ],
          ]),
        ),
        missingData: content.sections.flatMap((s) =>
          (s.suggestion?.missingData ?? []).map((m) => ({ section: s.number, item: m })),
        ),
        llmModel: content.generation.model,
        promptVersion: this.agent.promptVersion,
        createdBy: job.requestedBy ?? undefined,
      });
      if (!document.isSuccess || !document.data) throw new Error(document.message);

      const status =
        errors.length || suggestions.size < 16 ? SdsGenerationStatus.PARTIAL : SdsGenerationStatus.COMPLETED;
      await this.jobs.complete(jobId, document.data.id, status, {
        step: 'done',
        sectionsWithSuggestion: suggestions.size,
        usage: content.generation.usage,
        durationMs: content.generation.durationMs,
        errors,
      });
      this.logger.log(
        `FDS ${document.data.id} (job ${jobId}): ${status}, ${suggestions.size}/16 secciones, ` +
          `${usage.promptTokens}+${usage.completionTokens} tokens, US$ ${(usage.cost ?? 0).toFixed(4)}`,
      );
      return Result.success({ documentId: document.data.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.jobs.fail(jobId, message);
      return this.handleException('RunSdsGeneration', error);
    }
  }

  private async draftGroup(
    sections: number[],
    request: GenerateSdsRequestDTO,
    components: Array<{ cas: string; name: string | null; percentage: number }>,
    productKind: SdsProductKind,
    inert: ReadonlySet<string>,
  ): Promise<GroupResult> {
    const empty: GroupResult = {
      suggestions: new Map(),
      usage: { promptTokens: 0, completionTokens: 0 },
      fragments: 0,
    };
    const label = `Secciones ${sections.join(', ')}`;
    const startedAt = Date.now();
    try {
      return await withDeadline(
        this.draftSections(sections, request, components, productKind, inert),
        GROUP_DEADLINE_MS,
        label,
      );
    } catch (error) {
      const message = `${label}: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(`${message} (${Date.now() - startedAt} ms)`);
      return { ...empty, error: message };
    }
  }

  private async draftSections(
    sections: number[],
    request: GenerateSdsRequestDTO,
    components: Array<{ cas: string; name: string | null; percentage: number }>,
    productKind: SdsProductKind,
    inert: ReadonlySet<string>,
  ): Promise<GroupResult> {
    const label = `Secciones ${sections.join(', ')}`;
    const startedAt = Date.now();
    {
      // Contexto: TODO el conocimiento vigente de todas las fuentes de cada componente, priorizado
      // (núcleo → fragmentos de estas secciones → resto por similitud) hasta el presupuesto de tamaño.
      // Fuera de la clasificación y la composición, el conocimiento de un diluyente inerte no entra: así
      // la ficha de una mezcla no se llena con la toxicidad o las propiedades del agua.
      const relevant = sections.some((n) => COMPOSITION_SECTIONS.includes(n))
        ? components
        : components.filter((c) => !inert.has(c.cas));
      const casList = (relevant.length ? relevant : components).map((c) => c.cas);
      const context = await this.buildContext.execute({ casList, sections });
      if (!context.isSuccess) throw new Error(context.message);
      const fragments = context.data ?? [];

      // Referencias cortas (K1, K2…) por grupo: baratas en tokens y fáciles de verificar.
      const refs = new Map<string, KnowledgeSearchHit>(fragments.map((fragment, i) => [`K${i + 1}`, fragment]));
      const relevance = new Map(fragments.map((fragment, i) => [`K${i + 1}`, fragment.relevance]));
      const templates = sections.map((n) => SdsSectionCatalog.forProduct(n, productKind));
      const input = {
        language: request.language,
        destinationCountry: request.destinationCountry,
        productName: request.product?.name,
        components: components.map((c) => ({ ...c, inert: inert.has(c.cas) })),
        specialist: SdsSpecialistProfiles.forSections(sections),
      };
      const knowledge = [...refs].map(([ref, hit]) => ({
        ref,
        source: hit.source,
        cas: hit.cas,
        title: hit.title,
        content: hit.content,
        relevance: relevance.get(ref) ?? ('related' as const),
      }));
      // En una sustancia pura sobra el "Tolueno: " delante de cada dato (en una mezcla atribuye al componente).
      const cleanup: DraftCleanup =
        productKind === 'substance'
          ? { ownNames: [components[0]?.name, request.product?.name].filter((name): name is string => !!name) }
          : {};
      const toSuggestions = (drafts: SdsSectionDraft[], definitions: readonly SdsSectionDefinition[]) =>
        new Map(
          SectionSuggestionBuilder.mergeDrafts(drafts).flatMap((draft) => {
            const definition = definitions.find((d) => d.number === draft.number);
            return definition
              ? [
                  [
                    draft.number,
                    SectionSuggestionBuilder.fromAgent(definition, draft, refs, request.language, cleanup),
                  ] as const,
                ]
              : [];
          }),
        );

      // 1.ª pasada: todos los campos de las secciones del grupo.
      const first = await this.agent.run({ ...input, sections: templates, knowledge });
      const suggestions = toSuggestions(first.output.sections, templates);
      const usage = { ...first.usage };

      // 2.ª pasada, solo si quedaron campos vacíos: se le vuelven a mostrar ESOS campos con los fragmentos
      // propios de estas secciones. Recupera datos que el modelo pasó por alto; si falla, queda la 1.ª.
      const pending = GapReviewPlanner.pending(templates, suggestions);
      const focused = knowledge.filter((fragment) => fragment.relevance !== 'related');
      if (pending.length && focused.length) {
        try {
          const review = await this.agent.run({ ...input, sections: pending, knowledge: focused, review: true });
          for (const [number, reviewed] of toSuggestions(review.output.sections, pending)) {
            const base =
              suggestions.get(number) ??
              SectionSuggestionBuilder.fromSources(
                templates.find((t) => t.number === number)!,
                {},
                request.language,
              );
            suggestions.set(number, GapReviewPlanner.apply(base, reviewed, request.language));
          }
          usage.promptTokens += review.usage.promptTokens;
          usage.completionTokens += review.usage.completionTokens;
          usage.cost = (usage.cost ?? 0) + (review.usage.cost ?? 0);
        } catch (error) {
          this.logger.warn(`Secciones ${sections.join(', ')}: la revisión de campos vacíos falló: ${String(error)}`);
        }
      }
      this.logger.log(
        `${label}: ${refs.size} fragmentos, ${usage.promptTokens}+${usage.completionTokens} tokens, ` +
          `${pending.length ? 'con' : 'sin'} revisión (${Date.now() - startedAt} ms)`,
      );
      return { suggestions, usage, model: first.model, fragments: refs.size };
    }
  }
}

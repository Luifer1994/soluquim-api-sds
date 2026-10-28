import { Injectable } from '@nestjs/common';
import { SdsGenerationStatus } from '@prisma/client';
import { LlmUsage } from '@/shared/ai';
import { BaseService } from '@/shared/base';
import { AppConfig } from '@/shared/config';
import { Result, withDeadline } from '@/shared/util';
import {
  BuildSectionContextService,
  KnowledgeSearchHit,
  SdsProductKind,
  SdsSectionCatalog,
  SdsSectionDefinition,
  SyncSubstanceKnowledgeService,
} from '@/modules/knowledge';
import {
  BuildProductDocumentContextService,
  BuildReferenceContextService,
  PrepareProductDocumentsService,
  PRODUCT_DOCUMENT_CITATION_SOURCE,
  ProductDocument,
  REFERENCE_CITATION_SOURCE,
} from '@/modules/reference';
import { CurrentSourceData, ListCurrentSourceDataService } from '@/modules/substance';
import {
  CreateSdsDocumentDraftService,
  SdsDocumentContentDTO,
  SdsSectionSuggestionDTO,
} from '@/modules/sds/sdsdocument';
import {
  PromptProductDocument,
  PromptReference,
  SdsSectionDraft,
  SdsSectionDraftingAgent,
  SdsSpecialistProfile,
  SdsSpecialistProfiles,
} from '@/modules/sds/sdsgeneration/agent';
import {
  ClassificationEndpointFiller,
  ComponentHazardProfile,
  DeterministicSectionBuilder,
  DraftCleanup,
  GapReviewPlanner,
  MixtureConcentrationProfile,
  MixturePropertyFilter,
  ProductReferenceQuery,
  ProductReferenceQueryBuilder,
  RegulatorySectionBuilder,
  SectionEvidenceCollector,
  SectionSuggestionBuilder,
  SourceFallbackFiller,
} from '@/modules/sds/sdsgeneration/assembler';
import { CountryRegulatoryProfile, CountryRegulatoryProfiles } from '@/modules/sds/sdsgeneration/country';
import { GenerateSdsRequestDTO } from '@/modules/sds/sdsgeneration/dto/request';
import { MixtureConcentration } from '@/modules/sds/sdsmixture/concentration';
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
  /** Fragmentos de documentación de referencia que recibió el agente. */
  references: number;
  /** Fragmentos de documentos del producto que recibió el agente. */
  productDocuments: number;
  error?: string;
}

/** Cómo se le presenta al agente cada tipo de documento del producto. */
const PRODUCT_DOCUMENT_KINDS: Partial<Record<ProductDocument['category'], string>> = {
  SUPPLIER_SDS: 'FDS del proveedor',
  ANALOGOUS_SDS: 'FDS de producto análogo',
  PRODUCT_DATA: 'Datos del producto final',
};
const DEFAULT_PRODUCT_DOCUMENT_KIND = 'Documento del producto';

/** `percentage`: el máximo posible de su concentración (lo conservador); `concentration`: como se declaró. */
type DraftComponent = { cas: string; name: string | null; percentage: number; concentration: string };

/** Lo que comparten todos los grupos de una misma generación. */
interface DraftContext {
  request: GenerateSdsRequestDTO;
  components: DraftComponent[];
  /** Datos vigentes de las fuentes de cada componente. */
  current: CurrentSourceData[];
  productKind: SdsProductKind;
  inert: ReadonlySet<string>;
  country?: CountryRegulatoryProfile;
  referenceQuery: ProductReferenceQuery;
  /** Documentos del producto adjuntos a la generación, ya indexados. */
  productDocuments: ProductDocument[];
  /** Qué aporta cada componente según su concentración (bloque <mixture_rules>; solo mezclas). */
  mixtureRules?: string;
  /** Secciones de la etapa 1 ya redactadas (solo en la etapa 2). */
  priorSections?: string;
}

/**
 * Worker: genera el BORRADOR de la FDS de un job.
 *  1-2. SyncSubstanceKnowledgeService: datos de cada componente (la BD primero, las fuentes si falta o
 *       venció; versionado si cambió) y base de conocimiento al día (solo vectoriza lo nuevo).
 *  3. Por cada especialidad (grupo de secciones): contexto completo del RAG (priorizado) + los documentos
 *     del producto que adjuntó el usuario (FDS de las materias primas, de análogos…) + documentación de
 *     referencia cargada (SGA, GRE, procedimientos…) + reglas del país + qué aporta cada componente según
 *     su concentración (mezclas) + agente redactor, y una 2.ª pasada
 *     solo sobre los campos que quedaron vacíos. Por etapas (orden del TR-P-01): primero clasificación,
 *     propiedades y toxicología; después las medidas (emergencias, protección, eliminación, transporte),
 *     que reciben lo ya redactado para ser coherentes con ello.
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
    private readonly buildReferences: BuildReferenceContextService,
    private readonly prepareDocuments: PrepareProductDocumentsService,
    private readonly buildProductDocuments: BuildProductDocumentContextService,
    private readonly config: AppConfig,
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
        percentage: MixtureConcentration.upper(c),
        concentration: MixtureConcentration.label(c),
      }));

      // Documentos del producto adjuntos: listos (indexados) antes de redactar.
      const prepared = request.documentIds?.length
        ? await this.prepareDocuments.execute({ documentIds: request.documentIds, tenantId: job.tenantId })
        : null;
      if (prepared && !prepared.isSuccess) throw new Error(prepared.message);
      const productDocuments = prepared?.data?.documents ?? [];
      const documentErrors = prepared?.data?.skipped ?? [];

      // 3. Agente por grupo de secciones, por etapas.
      const productKind: SdsProductKind = components.length > 1 ? 'mixture' : 'substance';
      // Diluyentes sin clasificación de peligro (agua): solo cuentan para identificación y composición.
      const inert = new Set(current.filter((c) => ComponentHazardProfile.isInert(c)).map((c) => c.cas));
      const country = CountryRegulatoryProfiles.find(request.destinationCountry);
      const draftContext: DraftContext = {
        request,
        components,
        current,
        productKind,
        inert,
        country,
        referenceQuery: ProductReferenceQueryBuilder.build(components, current),
        productDocuments,
        mixtureRules:
          productKind === 'mixture'
            ? MixtureConcentrationProfile.render(
                MixtureConcentrationProfile.build(components, current, {
                  lowerCutOffs: country?.lowerGenericCutOffs ?? false,
                }),
              ) || undefined
            : undefined,
      };
      const [stageOne, stageTwo] = this.stages();
      await this.jobs.progress(jobId, SdsGenerationStatus.DRAFTING, {
        step: 'drafting',
        stage: 1,
        groups: SECTION_GROUPS.length,
      });
      const firstGroups = await Promise.all(stageOne.map((profile) => this.draftGroup(profile.sections, draftContext)));
      // La etapa 1 se completa una sola vez: es el contexto de la etapa 2 y parte de la ficha final.
      const firstSections = RunSdsGenerationService.complete(this.withAllSections(firstGroups, stageOne), draftContext);
      let secondGroups: GroupResult[] = [];
      if (stageTwo.length) {
        await this.jobs.progress(jobId, SdsGenerationStatus.DRAFTING, {
          step: 'drafting',
          stage: 2,
          groups: SECTION_GROUPS.length,
        });
        const priorSections = ProductReferenceQueryBuilder.priorSections(
          firstSections,
          new Map(SdsSectionCatalog.all().map((section) => [section.number, section.title])),
        );
        secondGroups = await Promise.all(
          stageTwo.map((profile) => this.draftGroup(profile.sections, { ...draftContext, priorSections })),
        );
      }
      const groups = [...firstGroups, ...secondGroups];

      // 4. Armado. Las secciones 1, 15 y 16 NO pasan por la IA: salen de la solicitud, de las fuentes y del sistema.
      const generatedAt = new Date();
      const suggestions = new Map([
        ...firstSections,
        ...RunSdsGenerationService.complete(this.withAllSections(secondGroups, stageTwo), draftContext),
      ]);
      suggestions.set(1, DeterministicSectionBuilder.section1(request, productKind));
      suggestions.set(
        15,
        RegulatorySectionBuilder.section15(
          // Los diluyentes sin clasificación de peligro no aportan reglamentación específica.
          current.some((c) => !inert.has(c.cas)) ? current.filter((c) => !inert.has(c.cas)) : current,
          productKind,
          request.language,
          country,
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
      const errors = [...indexErrors, ...documentErrors, ...groups.flatMap((g) => (g.error ? [g.error] : []))];
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
          referenceFragments: groups.reduce((sum, g) => sum + g.references, 0),
          productDocumentFragments: groups.reduce((sum, g) => sum + g.productDocuments, 0),
          staged: stageTwo.length > 0,
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

  /**
   * Lo que el agente dejó vacío (o no pudo redactar) y las fuentes sí traen tal cual, se llena con la fuente;
   * en la sección 11, cada clase de peligro vacía dice lo que establece la clasificación armonizada; y en las
   * propiedades de una mezcla (sección 9) se quitan los valores de componentes minoritarios.
   */
  private static complete(
    drafted: ReadonlyMap<number, SdsSectionSuggestionDTO | null>,
    { current, components, productKind, request }: DraftContext,
  ): Map<number, SdsSectionSuggestionDTO> {
    const completed = new Map<number, SdsSectionSuggestionDTO>();
    for (const [number, draft] of drafted) {
      const context = { number, components: current, productKind, language: request.language };
      const suggestion = ClassificationEndpointFiller.fill({
        ...context,
        suggestion: SourceFallbackFiller.fill({ ...context, suggestion: draft }),
      });
      if (!suggestion) continue;
      completed.set(
        number,
        number === 9 ? MixturePropertyFilter.apply(suggestion, components, request.language) : suggestion,
      );
    }
    return completed;
  }

  /** Etapas de redacción: con AI_STAGED_DRAFTING, datos y clasificación primero y medidas después. */
  private stages(): [readonly SdsSpecialistProfile[], readonly SdsSpecialistProfile[]] {
    const profiles = SdsSpecialistProfiles.all();
    if (!this.config.ai.stagedDrafting) return [profiles, []];
    return [profiles.filter((profile) => profile.stage === 1), profiles.filter((profile) => profile.stage === 2)];
  }

  /**
   * Sugerencias de los grupos, con TODAS las secciones de sus especialidades (también las que el agente no
   * devolvió o cuyo grupo falló, en null): así las fuentes las completan igual.
   */
  private withAllSections(
    groups: readonly GroupResult[],
    profiles: readonly SdsSpecialistProfile[],
  ): Map<number, SdsSectionSuggestionDTO | null> {
    const drafted = new Map(groups.flatMap((g) => [...g.suggestions]));
    return new Map(
      profiles.flatMap((profile) => profile.sections).map((number) => [number, drafted.get(number) ?? null]),
    );
  }

  private async draftGroup(sections: number[], context: DraftContext): Promise<GroupResult> {
    const empty: GroupResult = {
      suggestions: new Map(),
      usage: { promptTokens: 0, completionTokens: 0 },
      fragments: 0,
      references: 0,
      productDocuments: 0,
    };
    const label = `Secciones ${sections.join(', ')}`;
    const startedAt = Date.now();
    try {
      return await withDeadline(this.draftSections(sections, context), GROUP_DEADLINE_MS, label);
    } catch (error) {
      const message = `${label}: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(`${message} (${Date.now() - startedAt} ms)`);
      return { ...empty, error: message };
    }
  }

  /** Documentación de referencia para estas secciones. Si falla, la sección se redacta sin ella. */
  private async referencesFor(sections: number[], context: DraftContext) {
    const result = await this.buildReferences.execute({ sections, ...context.referenceQuery });
    if (!result.isSuccess) {
      this.logger.warn(`Secciones ${sections.join(', ')}: sin documentación de referencia (${result.message})`);
      return [];
    }
    return result.data ?? [];
  }

  /** Documentos del producto para estas secciones. Si falla, la sección se redacta sin ellos. */
  private async productDocumentsFor(sections: number[], context: DraftContext) {
    if (!context.productDocuments.length) return [];
    const result = await this.buildProductDocuments.execute({
      documents: context.productDocuments,
      sections,
      product: context.referenceQuery.product,
    });
    if (!result.isSuccess) {
      this.logger.warn(`Secciones ${sections.join(', ')}: sin documentos del producto (${result.message})`);
      return [];
    }
    return result.data ?? [];
  }

  private async draftSections(sections: number[], context: DraftContext): Promise<GroupResult> {
    const { request, components, productKind, inert } = context;
    const label = `Secciones ${sections.join(', ')}`;
    const startedAt = Date.now();

    // Contexto: TODO el conocimiento vigente de todas las fuentes de cada componente, priorizado
    // (núcleo → fragmentos de estas secciones → resto por similitud) hasta el presupuesto de tamaño.
    // Fuera de la clasificación y la composición, el conocimiento de un diluyente inerte no entra: así
    // la ficha de una mezcla no se llena con la toxicidad o las propiedades del agua.
    const relevant = sections.some((n) => COMPOSITION_SECTIONS.includes(n))
      ? components
      : components.filter((c) => !inert.has(c.cas));
    const casList = (relevant.length ? relevant : components).map((c) => c.cas);
    const [knowledgeContext, referenceFragments, documentFragments] = await Promise.all([
      this.buildContext.execute({ casList, sections }),
      this.referencesFor(sections, context),
      this.productDocumentsFor(sections, context),
    ]);
    if (!knowledgeContext.isSuccess) throw new Error(knowledgeContext.message);
    const fragments = knowledgeContext.data ?? [];

    // Referencias cortas por grupo (K1… datos de la sustancia; D1… documentos del producto; R1…
    // documentación de referencia): baratas en tokens y fáciles de verificar. Todas se validan igual.
    const refs = new Map<string, KnowledgeSearchHit>([
      ...fragments.map((fragment, i) => [`K${i + 1}`, fragment] as const),
      ...documentFragments.map(
        (fragment, i) =>
          [
            `D${i + 1}`,
            RunSdsGenerationService.citable(fragment, PRODUCT_DOCUMENT_CITATION_SOURCE, sections, request.language),
          ] as const,
      ),
      ...referenceFragments.map(
        (fragment, i) =>
          [
            `R${i + 1}`,
            RunSdsGenerationService.citable(fragment, REFERENCE_CITATION_SOURCE, sections, fragment.language),
          ] as const,
      ),
    ]);
    const templates = sections.map((n) => SdsSectionCatalog.forProduct(n, productKind));
    const input = {
      language: request.language,
      destinationCountry: request.destinationCountry,
      productName: request.product?.name,
      components: components.map((c) => ({ ...c, inert: inert.has(c.cas) })),
      specialist: SdsSpecialistProfiles.forSections(sections),
      references: referenceFragments.map((fragment, i): PromptReference => ({
        ref: `R${i + 1}`,
        title: fragment.citationTitle,
        category: fragment.category,
        content: fragment.content,
      })),
      productDocuments: documentFragments.map((fragment, i): PromptProductDocument => ({
        ref: `D${i + 1}`,
        title: fragment.citationTitle,
        kind: PRODUCT_DOCUMENT_KINDS[fragment.document.category] ?? DEFAULT_PRODUCT_DOCUMENT_KIND,
        component: RunSdsGenerationService.componentLabel(fragment.document.cas, components),
        content: fragment.content,
      })),
      mixtureRules: context.mixtureRules,
      priorSections: context.priorSections,
      country: context.country,
    };
    const knowledge = fragments.map((hit, i) => ({
      ref: `K${i + 1}`,
      source: hit.source,
      cas: hit.cas,
      title: hit.title,
      content: hit.content,
      relevance: hit.relevance,
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
        this.logger.warn(`${label}: la revisión de campos vacíos falló: ${String(error)}`);
      }
    }
    this.logger.log(
      `${label}: ${refs.size} fragmentos, ${usage.promptTokens}+${usage.completionTokens} tokens, ` +
        `${pending.length ? 'con' : 'sin'} revisión (${Date.now() - startedAt} ms)`,
    );
    return {
      suggestions,
      usage,
      model: first.model,
      fragments: fragments.length,
      references: referenceFragments.length,
      productDocuments: documentFragments.length,
    };
  }

  /** Un fragmento de un documento subido, citable igual que el conocimiento por CAS (D… o R…). */
  private static citable(
    fragment: {
      id: string;
      citationTitle: string;
      content: string;
      similarity: number | null;
      document?: ProductDocument;
    },
    source: string,
    sections: number[],
    language: string,
  ): KnowledgeSearchHit {
    return {
      id: fragment.id,
      cas: fragment.document?.cas ?? null,
      source,
      title: fragment.citationTitle,
      content: fragment.content,
      sdsSections: sections,
      sourceUrl: null,
      language,
      similarity: fragment.similarity,
    };
  }

  /** "Etanol (CAS 64-17-5)": el componente que describe un documento del producto. */
  private static componentLabel(cas: string | null, components: readonly DraftComponent[]): string | undefined {
    if (!cas) return undefined;
    const component = components.find((c) => c.cas === cas);
    return component ? `${component.name ?? 'Sin nombre'} (CAS ${component.cas})` : `CAS ${cas}`;
  }
}

import { Injectable } from '@nestjs/common';
import { SourceStatus } from '@prisma/client';
import { BaseService } from '@/shared/base';
import { AsyncTaskPublisher } from '@/shared/messaging';
import { contentHash, Result, SingleFlight } from '@/shared/util';
import {
  BaseSourceProvider,
  SourceCodeEnum,
  SourceFetchResult,
  SourceProviderRegistry,
  SourceRecord,
  SourceStatusEnum,
} from '@/modules/source';
import { SubstanceIdentity, SubstanceRepository } from '@/modules/substance/substance/repository';
import { SubstanceSourceDataDTO } from '@/modules/substance/substancesourcedata/dto';
import {
  RawSnapshotRepository,
  SubstanceSourceDataRepository,
  SubstanceSourceDataWithUrl,
} from '@/modules/substance/substancesourcedata/repository';
import { SourceFetchScheduler } from '@/modules/substance/substancesourcedata/messaging/SourceFetchScheduler';
import {
  KnowledgeIndexPayload,
  SourceTaskTypes,
} from '@/modules/substance/substancesourcedata/messaging/SourceTaskTypes';

export interface CollectSubstanceDataInput {
  cas: string;
  /** Ignora el cache y vuelve a consultar todas las fuentes. */
  refresh?: boolean;
  /** Solo estas fuentes (por defecto, todas las activas). */
  sources?: SourceCodeEnum[];
  /**
   * `true` = consultar también las fuentes lentas (modo background) en el momento. Lo usa el worker;
   * en una petición HTTP esas fuentes se encargan al worker y vuelven como PENDING.
   */
  runBackgroundSources?: boolean;
}

export interface CollectedSubstanceData {
  cas: string;
  sources: SubstanceSourceDataDTO[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Resultados que se cachean: el dato de la fuente o la certeza de que no lo tiene. Los fallos no. */
const CACHEABLE = new Set<SourceStatusEnum>([SourceStatusEnum.OK, SourceStatusEnum.NOT_FOUND]);

/**
 * Datos de un CAS en TODAS las fuentes activas, con cache en la BD propia (patrón cache-aside):
 *  - Cache vigente (OK o NOT_FOUND sin vencer) → se devuelve sin llamar a la fuente.
 *  - Vencido o `refresh` → se consulta la fuente; OK/NOT_FOUND se guardan con su TTL y el crudo
 *    se archiva como snapshot.
 *  - La fuente falla pero había un dato bueno → se devuelve ese dato marcado `stale` (stale-if-error).
 *  - Fuente lenta (modo background, p. ej. OSHA) sin cache → se encarga al worker y vuelve PENDING
 *    (o el dato viejo marcado `stale`, si había); en la próxima consulta ya está en el cache.
 * Las fuentes se consultan en paralelo y si dos requests piden el mismo CAS a la vez, comparten la
 * misma consulta (single-flight).
 */
@Injectable()
export class CollectSubstanceDataService extends BaseService<CollectSubstanceDataInput, CollectedSubstanceData> {
  private readonly singleFlight = new SingleFlight<SourceFetchResult>();

  constructor(
    private readonly registry: SourceProviderRegistry,
    private readonly substances: SubstanceRepository,
    private readonly sourceData: SubstanceSourceDataRepository,
    private readonly snapshots: RawSnapshotRepository,
    private readonly scheduler: SourceFetchScheduler,
    private readonly publisher: AsyncTaskPublisher,
  ) {
    super();
  }

  async execute({
    cas,
    refresh = false,
    sources: only,
    runBackgroundSources = false,
  }: CollectSubstanceDataInput): Promise<Result<CollectedSubstanceData>> {
    try {
      await this.substances.ensureExists(cas);
      const cached = new Map((await this.sourceData.findByCas(cas)).map((row) => [row.source, row]));

      const providers = this.registry.all().filter((provider) => !only || only.includes(provider.code));
      const sources = await Promise.all(
        providers.map((provider) =>
          this.collectFromSource(provider, cas, { refresh, runBackgroundSources }, cached.get(provider.code)),
        ),
      );

      await this.updateIdentity(cas, sources);
      return Result.success({ cas, sources });
    } catch (error) {
      return this.handleException('CollectSubstanceData', error);
    }
  }

  private async collectFromSource(
    provider: BaseSourceProvider,
    cas: string,
    options: { refresh: boolean; runBackgroundSources: boolean },
    cached: SubstanceSourceDataWithUrl | undefined,
  ): Promise<SubstanceSourceDataDTO> {
    const { refresh } = options;
    const cachedStatus = cached?.status as SourceStatusEnum | undefined;
    // Además de no estar vencido, lo guardado debe ser posterior al último cambio de extracción de la fuente.
    const isCurrent = !provider.extractionUpdatedAt || (cached?.retrievedAt ?? 0) >= provider.extractionUpdatedAt;
    if (
      !refresh &&
      cached &&
      cachedStatus &&
      CACHEABLE.has(cachedStatus) &&
      cached.expiresAt > new Date() &&
      isCurrent
    ) {
      return this.fromRow(cached, { stale: false });
    }

    if (provider.mode === 'background' && !options.runBackgroundSources) {
      return this.deferToWorker(provider, cas, refresh, cached);
    }

    const result = await this.singleFlight.run(`${provider.code}:${cas}`, () => provider.fetch(cas));

    if (!CACHEABLE.has(result.status)) {
      // stale-if-error: mejor un dato viejo (marcado) que nada.
      if (cached && cachedStatus === SourceStatusEnum.OK)
        return this.fromRow(cached, { stale: true, error: result.error });
      return this.fromResult(result);
    }

    const ttlDays = result.status === SourceStatusEnum.OK ? provider.cacheTtlDays : provider.notFoundTtlDays;
    const expiresAt = new Date(result.retrievedAt.getTime() + ttlDays * DAY_MS);
    const hash = contentHash(result.records);
    const looksChanged =
      !cached ||
      SubstanceSourceDataRepository.hashOf(cached) !== hash ||
      cached.status !== (result.status as SourceStatus);

    // Cada fuente está aislada también al guardar: si el cache de UNA falla, su dato se devuelve igual
    // (sin cachear) y el resto de fuentes no se entera.
    try {
      // El crudo solo se archiva si el contenido cambió (no se guardan copias idénticas en cada refresco).
      const rawSnapshotId = result.raw && looksChanged ? await this.saveSnapshot(result) : undefined;
      const saved = await this.sourceData.saveVersioned({
        cas,
        source: provider.code,
        status: result.status as SourceStatus,
        records: result.records,
        contentHash: hash,
        durationMs: result.durationMs,
        retrievedAt: result.retrievedAt,
        expiresAt,
        rawSnapshotId,
      });
      if (saved.changed) await this.requestIndexing({ cas, source: provider.code });
      return { ...this.fromResult(result, expiresAt), version: saved.version, changed: saved.changed };
    } catch (error) {
      this.logger.error(
        `No se pudo guardar el cache de ${provider.code}/${cas}: ${error instanceof Error ? error.message.split('\n').pop() : String(error)}`,
      );
      return this.fromResult(result);
    }
  }

  /** Encarga al worker (re)vectorizar la fuente en la base de conocimiento. Si falla, no rompe la consulta. */
  private async requestIndexing(payload: KnowledgeIndexPayload): Promise<void> {
    try {
      await this.publisher.publish(SourceTaskTypes.KNOWLEDGE_INDEX, payload);
    } catch (error) {
      this.logger.warn(`No se pudo encargar la vectorización de ${payload.source}/${payload.cas}: ${String(error)}`);
    }
  }

  /** Fuente lenta: se encarga al worker. Mientras tanto, el último dato bueno (stale) o PENDING. */
  private async deferToWorker(
    provider: BaseSourceProvider,
    cas: string,
    refresh: boolean,
    cached: SubstanceSourceDataWithUrl | undefined,
  ): Promise<SubstanceSourceDataDTO> {
    await this.scheduler.schedule({ cas, source: provider.code, refresh });
    const message = `${provider.code} se consulta en segundo plano (es lenta por diseño); estará disponible en la próxima consulta`;
    if (cached && (cached.status as SourceStatusEnum) === SourceStatusEnum.OK) {
      return this.fromRow(cached, { stale: true, error: message });
    }
    return {
      source: provider.code,
      status: SourceStatusEnum.PENDING,
      fromCache: false,
      stale: false,
      retrievedAt: new Date().toISOString(),
      error: message,
      records: [],
    };
  }

  /** El snapshot es para auditoría: si falla al guardarse, se registra y la consulta sigue. */
  private async saveSnapshot(result: SourceFetchResult): Promise<string | undefined> {
    try {
      return await this.snapshots.create({ cas: result.cas, source: result.source, ...result.raw! });
    } catch (error) {
      this.logger.warn(`No se pudo guardar el snapshot de ${result.source}/${result.cas}: ${String(error)}`);
      return undefined;
    }
  }

  /**
   * Nombre, fórmula y sinónimos de la sustancia, con los datos de TODAS las fuentes que respondieron
   * (frescos o del cache). PubChem es la fuente de identidad: si la tiene, manda. Las demás, en orden,
   * solo COMPLETAN lo que esté vacío (nunca cambian "Ethanol" por "Ethyl alcohol"). Solo se escribe en
   * la BD si algo cambió.
   */
  private async updateIdentity(cas: string, sources: SubstanceSourceDataDTO[]): Promise<void> {
    const ok = new Map(sources.filter((s) => s.status === SourceStatusEnum.OK).map((s) => [s.source, s]));
    if (!ok.size) return;

    const value = <T>(code: SourceCodeEnum, field: string): T | undefined =>
      ok.get(code)?.records.find((record) => record.field === field)?.value as T | undefined;
    const firstOf = <T>(fields: Array<[SourceCodeEnum, string]>): T | undefined => {
      for (const [code, field] of fields) {
        const found = value<T>(code, field);
        if (found !== undefined && found !== '' && !(Array.isArray(found) && !found.length)) return found;
      }
      return undefined;
    };

    const current = await this.substances.findByCas(cas);
    const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
    /** PubChem pisa; el resto solo completa si está vacío. */
    const resolve = <T>(
      currentValue: T | null | undefined,
      fromPubChem: T | undefined,
      fallback: () => T | undefined,
    ) => fromPubChem ?? (isEmpty(currentValue) ? fallback() : undefined);

    const { PUBCHEM, ECHA, COMPTOX, NIST, ICSC, NIOSH_NPG } = SourceCodeEnum;
    const identity: SubstanceIdentity = {
      name: resolve(current?.name, value<string>(PUBCHEM, 'identity.name'), () =>
        firstOf<string>([
          [ECHA, 'identity.name'],
          [COMPTOX, 'identity.name'],
          [NIST, 'identity.name'],
          [NIOSH_NPG, 'identity.name'],
          [ICSC, 'identity.name'],
        ]),
      ),
      iupacName: resolve(current?.iupacName, value<string>(PUBCHEM, 'identity.iupacName'), () =>
        firstOf<string>([[ECHA, 'identity.iupacName']]),
      ),
      formula: resolve(current?.formula, value<string>(PUBCHEM, 'identity.molecularFormula'), () =>
        firstOf<string>([
          [COMPTOX, 'identity.molecularFormula'],
          [NIST, 'identity.molecularFormula'],
          [NIOSH_NPG, 'identity.formula'],
        ]),
      ),
      synonyms: resolve(current?.synonyms, value<string[]>(PUBCHEM, 'identity.synonyms'), () =>
        firstOf<string[]>([
          [NIOSH_NPG, 'identity.synonyms'],
          [ICSC, 'identity.synonyms'],
        ]),
      ),
    };

    const changed = (Object.keys(identity) as Array<keyof SubstanceIdentity>).some(
      (key) => identity[key] !== undefined && JSON.stringify(identity[key]) !== JSON.stringify(current?.[key] ?? null),
    );
    if (changed) await this.substances.updateIdentity(cas, identity);
  }

  private fromRow(row: SubstanceSourceDataWithUrl, extra: { stale: boolean; error?: string }): SubstanceSourceDataDTO {
    return {
      source: row.source as SourceCodeEnum,
      status: row.status as SourceStatusEnum,
      fromCache: true,
      stale: extra.stale,
      retrievedAt: row.retrievedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      durationMs: row.durationMs ?? undefined,
      sourceUrl: row.rawSnapshot?.url,
      error: extra.error,
      records: row.records as unknown as SourceRecord[],
      version: row.version,
    };
  }

  private fromResult(result: SourceFetchResult, expiresAt?: Date): SubstanceSourceDataDTO {
    return {
      source: result.source,
      status: result.status,
      fromCache: false,
      stale: false,
      retrievedAt: result.retrievedAt.toISOString(),
      expiresAt: expiresAt?.toISOString(),
      durationMs: result.durationMs,
      sourceUrl: result.sourceUrl,
      error: result.error,
      records: result.records,
    };
  }
}

import {
  BaseSourceProvider,
  SourceCodeEnum,
  SourceFetchResult,
  SourceProviderRegistry,
  SourceStatusEnum,
} from '@/modules/source';
import { SubstanceRepository } from '@/modules/substance/substance/repository';
import {
  RawSnapshotRepository,
  SaveSubstanceSourceData,
  SubstanceSourceDataRepository,
  SubstanceSourceDataWithUrl,
} from '@/modules/substance/substancesourcedata/repository';
import { AsyncTaskPublisher } from '@/shared/messaging';
import { SourceFetchScheduler } from '@/modules/substance/substancesourcedata/messaging';
import { CollectSubstanceDataService } from '@/modules/substance/substancesourcedata/service';

const CAS = '64-17-5';
const DAY = 24 * 60 * 60 * 1000;

function provider(result: Partial<SourceFetchResult>): BaseSourceProvider & { fetch: jest.Mock } {
  return {
    code: SourceCodeEnum.PUBCHEM,
    cacheTtlDays: 30,
    notFoundTtlDays: 7,
    fetch: jest.fn().mockResolvedValue({
      source: SourceCodeEnum.PUBCHEM,
      cas: CAS,
      status: SourceStatusEnum.OK,
      records: [{ field: 'identity.name', label: 'Title', value: 'Ethanol', sourceUrl: 'u' }],
      sourceUrl: 'https://pubchem.ncbi.nlm.nih.gov/compound/702',
      raw: { url: 'u', contentType: 'application/json', content: '{}' },
      retrievedAt: new Date(),
      durationMs: 100,
      ...result,
    }),
  } as unknown as BaseSourceProvider & { fetch: jest.Mock };
}

function row(overrides: Partial<SubstanceSourceDataWithUrl>): SubstanceSourceDataWithUrl {
  return {
    id: 'r1',
    cas: CAS,
    source: SourceCodeEnum.PUBCHEM,
    status: 'OK',
    records: [{ field: 'identity.name', label: 'Title', value: 'Ethanol (cache)', sourceUrl: 'u' }],
    error: null,
    durationMs: 50,
    retrievedAt: new Date(Date.now() - DAY),
    expiresAt: new Date(Date.now() + DAY),
    rawSnapshotId: null,
    contentHash: null,
    version: 1,
    validFrom: new Date(Date.now() - DAY),
    createdAt: new Date(),
    updatedAt: new Date(),
    rawSnapshot: { url: 'https://pubchem.ncbi.nlm.nih.gov/compound/702' },
    ...overrides,
  };
}

function setup(p: BaseSourceProvider, cached: SubstanceSourceDataWithUrl[] = [], currentSubstance: unknown = null) {
  const registry = { all: () => [p] } as unknown as SourceProviderRegistry;
  const substances = {
    ensureExists: jest.fn(),
    updateIdentity: jest.fn(),
    findByCas: jest.fn().mockResolvedValue(currentSubstance),
  } as unknown as SubstanceRepository;
  const sourceData = {
    findByCas: jest.fn().mockResolvedValue(cached),
    saveVersioned: jest.fn().mockResolvedValue({ changed: true, version: 1 }),
  } as unknown as SubstanceSourceDataRepository & { saveVersioned: jest.Mock };
  const snapshots = { create: jest.fn().mockResolvedValue('snap-1') } as unknown as RawSnapshotRepository;
  const scheduler = { schedule: jest.fn().mockResolvedValue(true) } as unknown as SourceFetchScheduler & {
    schedule: jest.Mock;
  };
  const publisher = { publish: jest.fn().mockResolvedValue('m-1') } as unknown as AsyncTaskPublisher & {
    publish: jest.Mock;
  };
  return {
    service: new CollectSubstanceDataService(registry, substances, sourceData, snapshots, scheduler, publisher),
    scheduler,
    publisher,
    snapshots: snapshots as RawSnapshotRepository & { create: jest.Mock },
    sourceData,
    substances,
  };
}

describe('CollectSubstanceDataService (cache-aside)', () => {
  it('sin cache: consulta la fuente, guarda con TTL y snapshot', async () => {
    const p = provider({});
    const { service, sourceData } = setup(p);

    const result = await service.execute({ cas: CAS });

    expect(p.fetch).toHaveBeenCalledWith(CAS);
    const saved = (sourceData.saveVersioned as jest.Mock).mock.calls[0][0] as SaveSubstanceSourceData;
    expect(saved).toMatchObject({ cas: CAS, source: 'PUBCHEM', status: 'OK', rawSnapshotId: 'snap-1' });
    expect(saved.expiresAt.getTime() - saved.retrievedAt.getTime()).toBe(30 * DAY);
    expect(result.data!.sources[0]).toMatchObject({ fromCache: false, stale: false, status: 'OK' });
  });

  it('cache vigente: NO llama a la fuente', async () => {
    const p = provider({});
    const { service } = setup(p, [row({})]);

    const result = await service.execute({ cas: CAS });

    expect(p.fetch).not.toHaveBeenCalled();
    expect(result.data!.sources[0]).toMatchObject({ fromCache: true, stale: false });
  });

  it('refresh=true: ignora el cache vigente', async () => {
    const p = provider({});
    const { service } = setup(p, [row({})]);
    await service.execute({ cas: CAS, refresh: true });
    expect(p.fetch).toHaveBeenCalled();
  });

  it('cache vencido: vuelve a consultar', async () => {
    const p = provider({});
    const { service } = setup(p, [row({ expiresAt: new Date(Date.now() - 1000) })]);
    await service.execute({ cas: CAS });
    expect(p.fetch).toHaveBeenCalled();
  });

  it('la fuente falla y había dato bueno: devuelve el viejo marcado stale (stale-if-error) y no lo pisa', async () => {
    const p = provider({ status: SourceStatusEnum.FAILED, records: [], raw: undefined, error: 'HTTP 503' });
    const { service, sourceData } = setup(p, [row({ expiresAt: new Date(Date.now() - 1000) })]);

    const result = await service.execute({ cas: CAS });

    expect(sourceData.saveVersioned).not.toHaveBeenCalled();
    expect(result.data!.sources[0]).toMatchObject({ status: 'OK', fromCache: true, stale: true, error: 'HTTP 503' });
    expect(result.data!.sources[0].records[0].value).toBe('Ethanol (cache)');
  });

  it('la fuente falla sin cache: devuelve FAILED y no cachea el fallo', async () => {
    const p = provider({ status: SourceStatusEnum.FAILED, records: [], raw: undefined, error: 'timeout' });
    const { service, sourceData } = setup(p);

    const result = await service.execute({ cas: CAS });

    expect(sourceData.saveVersioned).not.toHaveBeenCalled();
    expect(result.data!.sources[0]).toMatchObject({ status: 'FAILED', error: 'timeout' });
  });

  it('NOT_FOUND se cachea con su TTL corto', async () => {
    const p = provider({ status: SourceStatusEnum.NOT_FOUND, records: [], raw: undefined });
    const { service, sourceData } = setup(p);

    await service.execute({ cas: CAS });

    const saved = (sourceData.saveVersioned as jest.Mock).mock.calls[0][0] as SaveSubstanceSourceData;
    expect(saved.status).toBe('NOT_FOUND');
    expect(saved.expiresAt.getTime() - saved.retrievedAt.getTime()).toBe(7 * DAY);
  });

  it('dos consultas simultáneas del mismo CAS comparten una sola llamada a la fuente (single-flight)', async () => {
    const p = provider({});
    const { service } = setup(p);
    await Promise.all([service.execute({ cas: CAS }), service.execute({ cas: CAS })]);
    expect(p.fetch).toHaveBeenCalledTimes(1);
  });

  describe('identidad de la sustancia', () => {
    const nioshOnly = () => {
      const p = provider({
        source: SourceCodeEnum.NIOSH_NPG,
        records: [{ field: 'identity.name', label: 'Name', value: 'Ethyl alcohol', sourceUrl: 'u' }],
      });
      (p as unknown as { code: SourceCodeEnum }).code = SourceCodeEnum.NIOSH_NPG;
      return p;
    };

    it('PubChem manda: su nombre se guarda', async () => {
      const { service, substances } = setup(provider({}));
      await service.execute({ cas: CAS });
      expect(substances.updateIdentity).toHaveBeenCalledWith(CAS, expect.objectContaining({ name: 'Ethanol' }));
    });

    it('NIOSH NO pisa un nombre que ya existe (y si nada cambió, no escribe)', async () => {
      const { service, substances } = setup(nioshOnly(), [], {
        cas: CAS,
        name: 'Ethanol',
        iupacName: 'ethanol',
        formula: 'C2H6O',
        synonyms: ['ethanol'],
      });
      await service.execute({ cas: CAS });
      expect(substances.updateIdentity).not.toHaveBeenCalled();
    });

    it('usa también los datos del cache: completa el nombre aunque la fuente no se haya consultado ahora', async () => {
      const p = provider({});
      const { service, substances } = setup(p, [row({})], {
        cas: CAS,
        name: null,
        iupacName: null,
        formula: null,
        synonyms: [],
      });
      await service.execute({ cas: CAS });
      expect(p.fetch).not.toHaveBeenCalled();
      expect(substances.updateIdentity).toHaveBeenCalledWith(CAS, expect.objectContaining({ name: 'Ethanol (cache)' }));
    });

    it('NIOSH completa el nombre si la sustancia no tenía', async () => {
      const { service, substances } = setup(nioshOnly(), [], { cas: CAS, name: null, formula: null, synonyms: [] });
      await service.execute({ cas: CAS });
      expect(substances.updateIdentity).toHaveBeenCalledWith(CAS, expect.objectContaining({ name: 'Ethyl alcohol' }));
    });
  });

  describe('fuentes lentas (modo background)', () => {
    const background = () => {
      const p = provider({});
      (p as unknown as { mode: string }).mode = 'background';
      return p;
    };

    it('sin cache en una petición HTTP: NO llama a la fuente, la encarga al worker y devuelve PENDING', async () => {
      const p = background();
      const { service, scheduler } = setup(p);

      const result = await service.execute({ cas: CAS });

      expect(p.fetch).not.toHaveBeenCalled();
      expect(scheduler.schedule).toHaveBeenCalledWith({ cas: CAS, source: 'PUBCHEM', refresh: false });
      expect(result.data!.sources[0].status).toBe('PENDING');
    });

    it('con cache vencido: devuelve el dato viejo marcado stale mientras el worker actualiza', async () => {
      const p = background();
      const { service, scheduler } = setup(p, [row({ expiresAt: new Date(Date.now() - 1000) })]);

      const result = await service.execute({ cas: CAS });

      expect(scheduler.schedule).toHaveBeenCalled();
      expect(result.data!.sources[0]).toMatchObject({ status: 'OK', stale: true });
    });

    it('en el worker (runBackgroundSources): sí consulta la fuente y la guarda', async () => {
      const p = background();
      const { service, sourceData, scheduler } = setup(p);

      await service.execute({ cas: CAS, runBackgroundSources: true });

      expect(p.fetch).toHaveBeenCalled();
      expect(sourceData.saveVersioned).toHaveBeenCalled();
      expect(scheduler.schedule).not.toHaveBeenCalled();
    });
  });

  it('si falla el guardado del cache de una fuente, su dato se devuelve igual (no se pierde la consulta)', async () => {
    const p = provider({});
    const { service, sourceData } = setup(p);
    (sourceData.saveVersioned as jest.Mock).mockRejectedValueOnce(new Error('Invalid value'));

    const result = await service.execute({ cas: CAS });

    expect(result.isSuccess).toBe(true);
    expect(result.data!.sources[0]).toMatchObject({ status: 'OK', fromCache: false });
  });

  describe('versionado y base de conocimiento', () => {
    it('contenido nuevo o distinto: guarda con su hash, archiva el crudo y encarga re-vectorizar', async () => {
      const p = provider({});
      const { service, sourceData, publisher, snapshots } = setup(p, [row({ expiresAt: new Date(Date.now() - 1000) })]);

      const result = await service.execute({ cas: CAS });

      const saved = (sourceData.saveVersioned as jest.Mock).mock.calls[0][0] as SaveSubstanceSourceData;
      expect(saved.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(snapshots.create).toHaveBeenCalled();
      expect(publisher.publish).toHaveBeenCalledWith('sds.knowledge.index', { cas: CAS, source: 'PUBCHEM' });
      expect(result.data!.sources[0]).toMatchObject({ changed: true, version: 1 });
    });

    it('mismo contenido: no archiva otro crudo ni re-vectoriza', async () => {
      const records = [{ field: 'identity.name', label: 'Title', value: 'Ethanol', sourceUrl: 'u' }];
      const p = provider({ records });
      const { service, sourceData, publisher, snapshots } = setup(p, [
        row({ records, expiresAt: new Date(Date.now() - 1000) }),
      ]);
      (sourceData.saveVersioned as jest.Mock).mockResolvedValueOnce({ changed: false, version: 3 });

      const result = await service.execute({ cas: CAS });

      expect(snapshots.create).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
      expect(result.data!.sources[0]).toMatchObject({ changed: false, version: 3 });
    });
  });
});

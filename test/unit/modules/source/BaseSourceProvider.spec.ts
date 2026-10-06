import { ExternalHttpError } from '@/shared/http';
import {
  BaseSourceProvider,
  SourceCodeEnum,
  SourceFetchOutput,
  SourceKindEnum,
  SourceStatusEnum,
} from '@/modules/source';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';

class FakeProvider extends BaseSourceProvider {
  readonly code = SourceCodeEnum.PUBCHEM;
  readonly cacheTtlDays = 1;
  readonly info = {
    name: 'Fake',
    owner: 'test',
    kind: SourceKindEnum.API_JSON,
    homepage: 'https://example.org',
    sdsSections: [],
    description: 'fuente de prueba',
  };
  calls = 0;

  constructor(private readonly behavior: () => Promise<SourceFetchOutput>) {
    super();
  }

  protected override resilience() {
    return { timeoutMs: 1_000, maxAttempts: 3, breakAfter: 50 };
  }

  protected performFetch(): Promise<SourceFetchOutput> {
    this.calls++;
    return this.behavior();
  }
}

const OUTPUT: SourceFetchOutput = { records: [], sourceUrl: 'u', raw: { url: 'u', contentType: 'x', content: '' } };

describe('BaseSourceProvider', () => {
  it('OK: devuelve los datos', async () => {
    const provider = new FakeProvider(() => Promise.resolve(OUTPUT));
    expect((await provider.fetch('64-17-5')).status).toBe(SourceStatusEnum.OK);
  });

  it('"no encontrado" → NOT_FOUND, sin reintentar', async () => {
    const provider = new FakeProvider(() => Promise.reject(new SubstanceNotFoundInSourceError('X', '64-17-5')));
    const result = await provider.fetch('64-17-5');
    expect(result.status).toBe(SourceStatusEnum.NOT_FOUND);
    expect(provider.calls).toBe(1);
  });

  it('un 4xx (≠429) no se reintenta', async () => {
    const provider = new FakeProvider(() => Promise.reject(new ExternalHttpError(400, 'u')));
    expect((await provider.fetch('64-17-5')).status).toBe(SourceStatusEnum.FAILED);
    expect(provider.calls).toBe(1);
  });

  it('un 5xx transitorio se reintenta y si se recupera devuelve OK', async () => {
    let attempt = 0;
    const provider = new FakeProvider(() =>
      ++attempt < 2 ? Promise.reject(new ExternalHttpError(500, 'u')) : Promise.resolve(OUTPUT),
    );
    expect((await provider.fetch('64-17-5')).status).toBe(SourceStatusEnum.OK);
    expect(provider.calls).toBe(2);
  });

  it('Retry-After: no reintenta, se pausa y las siguientes consultas no llaman a la fuente', async () => {
    const provider = new FakeProvider(() => Promise.reject(new ExternalHttpError(503, 'u', 'busy', 30)));

    const first = await provider.fetch('64-17-5');
    const second = await provider.fetch('67-64-1');

    expect(first.status).toBe(SourceStatusEnum.FAILED);
    expect(second.status).toBe(SourceStatusEnum.CIRCUIT_OPEN);
    expect(second.error).toMatch(/pidió esperar/);
    expect(provider.calls).toBe(1);
  });

  it('runtimeState: circuito cerrado y sin pausa en condiciones normales', () => {
    const provider = new FakeProvider(() => Promise.resolve(OUTPUT));
    expect(provider.runtimeState(true)).toMatchObject({ enabled: true, circuit: 'closed', pausedUntil: undefined });
  });
});

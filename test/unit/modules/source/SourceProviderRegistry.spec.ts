import { AppConfig, parseEnv } from '@/shared/config';
import { BaseSourceProvider, SourceCodeEnum, SourceProviderRegistry } from '@/modules/source';

const provider = (code: SourceCodeEnum, enabledByDefault = true) =>
  ({ code, enabledByDefault }) as unknown as BaseSourceProvider;
const config = (SOURCES_ENABLED: string) =>
  new AppConfig(
    parseEnv({ DATABASE_URL: 'postgresql://u:p@h:5432/d', RABBITMQ_URL: 'amqp://u:p@h:5672', SOURCES_ENABLED }),
  );
const all = [provider(SourceCodeEnum.PUBCHEM), provider(SourceCodeEnum.ECHA), provider(SourceCodeEnum.OSHA, false)];

describe('SourceProviderRegistry', () => {
  it('"*" activa las fuentes por defecto (OSHA no)', () => {
    const registry = new SourceProviderRegistry(all, config('*'));
    expect(registry.all().map((p) => p.code)).toEqual(['PUBCHEM', 'ECHA']);
    expect(registry.implemented()).toHaveLength(3);
  });

  it('una lista explícita activa exactamente esas, incluso las apagadas por defecto', () => {
    const registry = new SourceProviderRegistry(all, config('echa, osha'));
    expect(registry.all().map((p) => p.code)).toEqual(['ECHA', 'OSHA']);
  });

  it('detecta fuentes duplicadas al arrancar', () => {
    const registry = new SourceProviderRegistry([...all, provider(SourceCodeEnum.ECHA)], config('*'));
    expect(() => registry.onModuleInit()).toThrow(/duplicadas: ECHA/);
  });
});

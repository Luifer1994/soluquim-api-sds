import 'reflect-metadata';
import { DiscoveryService } from '@nestjs/core';
import { AppConfig, parseEnv } from '@/shared/config';
import { DataSeeder, Seeder, SeederKind, SeederRunner } from '@/shared/seed';

const calls: string[] = [];

function makeSeeder(name: string, kind: SeederKind, order: number): DataSeeder {
  @Seeder()
  class TestSeeder implements DataSeeder {
    readonly kind = kind;
    readonly order = order;
    async run(): Promise<void> {
      calls.push(name);
    }
  }
  return new TestSeeder();
}

function runnerWith(env: Record<string, string>, seeders: DataSeeder[]): SeederRunner {
  const config = new AppConfig(
    parseEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db', RABBITMQ_URL: 'amqp://u:p@localhost:5672', ...env }),
  );
  const discovery = {
    getProviders: () => seeders.map((instance) => ({ instance, metatype: instance.constructor })),
  } as unknown as DiscoveryService;
  return new SeederRunner(config, discovery);
}

describe('SeederRunner', () => {
  const seeders = [
    makeSeeder('demo-1', 'demo', 1),
    makeSeeder('catalog-2', 'catalog', 2),
    makeSeeder('catalog-1', 'catalog', 1),
  ];

  beforeEach(() => (calls.length = 0));

  it('no siembra nada con los flags apagados (default)', async () => {
    await runnerWith({}, seeders).onApplicationBootstrap();
    expect(calls).toEqual([]);
  });

  it('APP_SEED_ENABLED corre solo los catálogos, en orden', async () => {
    await runnerWith({ APP_SEED_ENABLED: 'true' }, seeders).onApplicationBootstrap();
    expect(calls).toEqual(['catalog-1', 'catalog-2']);
  });

  it('APP_SEED_DEMO corre solo los demo (independiente de los catálogos)', async () => {
    await runnerWith({ APP_SEED_DEMO: 'true' }, seeders).onApplicationBootstrap();
    expect(calls).toEqual(['demo-1']);
  });

  it('con los dos flags: catálogos primero, demo después', async () => {
    await runnerWith({ APP_SEED_ENABLED: 'true', APP_SEED_DEMO: 'true' }, seeders).onApplicationBootstrap();
    expect(calls).toEqual(['catalog-1', 'catalog-2', 'demo-1']);
  });

  it('el worker nunca siembra', async () => {
    await runnerWith(
      { SDS_PROCESS: 'worker', APP_SEED_ENABLED: 'true', APP_SEED_DEMO: 'true' },
      seeders,
    ).onApplicationBootstrap();
    expect(calls).toEqual([]);
  });
});

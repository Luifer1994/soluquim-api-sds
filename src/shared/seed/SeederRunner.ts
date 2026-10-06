import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { AppConfig } from '@/shared/config';
import { DATA_SEEDER_KEY, DataSeeder, SeederKind } from '@/shared/seed/DataSeeder';

/**
 * Ejecuta los seeders al arrancar, según los flags del .env raíz (APP_SEED_ENABLED / APP_SEED_DEMO).
 * Solo en el proceso API: el worker comparte el código pero nunca siembra (evita correrlos dos veces).
 * Si un seeder falla, el arranque falla: mejor no levantar que levantar con datos a medias.
 */
@Injectable()
export class SeederRunner implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeederRunner.name);

  constructor(
    private readonly config: AppConfig,
    private readonly discovery: DiscoveryService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.process !== 'api') return;

    const kinds: SeederKind[] = [];
    if (this.config.seed.catalogs) kinds.push('catalog');
    if (this.config.seed.demo) kinds.push('demo');
    if (!kinds.length) return;

    const seeders = this.discover();
    for (const kind of kinds) {
      const batch = seeders.filter((seeder) => seeder.kind === kind).sort((a, b) => a.order - b.order);
      this.logger.log(`Sembrado '${kind}': ${batch.length} seeder(s)`);
      for (const seeder of batch) {
        const startedAt = Date.now();
        await seeder.run();
        this.logger.log(`  ✔ ${seeder.constructor.name} (${Date.now() - startedAt} ms)`);
      }
    }
  }

  private discover(): DataSeeder[] {
    return this.discovery
      .getProviders()
      .filter(
        (wrapper) => wrapper.metatype && wrapper.instance && Reflect.getMetadata(DATA_SEEDER_KEY, wrapper.metatype),
      )
      .map((wrapper) => wrapper.instance as DataSeeder);
  }
}

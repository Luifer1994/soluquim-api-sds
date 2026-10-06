import { SetMetadata } from '@nestjs/common';

export const DATA_SEEDER_KEY = 'soluquim:data-seeder';

export type SeederKind = 'catalog' | 'demo';

/**
 * Seeder de datos — equivalente a los `<Modulo>DataSeeder` (CommandLineRunner) de los micros Java.
 *
 * - `kind: 'catalog'` corre con APP_SEED_ENABLED=true (datos que el servicio NECESITA para funcionar).
 * - `kind: 'demo'`    corre con APP_SEED_DEMO=true (datos de prueba). Se apoya en los catálogos.
 * - `order`: menor primero. Dentro de un mismo `kind`.
 * - `run` debe ser IDEMPOTENTE (upsert): volver a sembrar una base ya sembrada no duplica nada.
 */
export interface DataSeeder {
  readonly kind: SeederKind;
  readonly order: number;
  run(): Promise<void>;
}

/** Marca un provider como seeder. El SeederRunner los descubre solo al arrancar. */
export const Seeder = () => SetMetadata(DATA_SEEDER_KEY, true);

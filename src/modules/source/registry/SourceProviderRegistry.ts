import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AppConfig } from '@/shared/config';
import { BaseSourceProvider } from '@/modules/source/base';
import { SourceCodeEnum } from '@/modules/source/enums';

/** Token con TODAS las fuentes implementadas (ver SourceModule). */
export const SOURCE_PROVIDERS = Symbol('SOURCE_PROVIDERS');

/**
 * Fuentes activas. Agregar una fuente = crear su provider (extiende BaseSourceProvider) y sumarlo a
 * la lista de SourceModule; nada más cambia (Open/Closed). Cuáles se consultan lo decide
 * SOURCES_ENABLED, sin tocar código.
 */
@Injectable()
export class SourceProviderRegistry implements OnModuleInit {
  private readonly logger = new Logger(SourceProviderRegistry.name);
  private readonly enabled: BaseSourceProvider[];

  constructor(
    @Inject(SOURCE_PROVIDERS) private readonly providers: BaseSourceProvider[],
    config: AppConfig,
  ) {
    const filter = config.sourcesEnabled;
    this.enabled = providers.filter((provider) =>
      filter === '*' ? provider.enabledByDefault : filter.has(provider.code),
    );
  }

  onModuleInit(): void {
    const codes = this.providers.map((provider) => provider.code);
    const duplicated = codes.filter((code, index) => codes.indexOf(code) !== index);
    if (duplicated.length) throw new Error(`Fuentes duplicadas: ${duplicated.join(', ')}`);
    this.logger.log(
      `Fuentes activas (${this.enabled.length}/${this.providers.length}): ${this.enabled.map((p) => p.code).join(', ')}`,
    );
  }

  /** Fuentes que se consultan. */
  all(): readonly BaseSourceProvider[] {
    return this.enabled;
  }

  /** Todas las implementadas, activas o no (para el catálogo). */
  implemented(): readonly BaseSourceProvider[] {
    return this.providers;
  }

  isEnabled(code: SourceCodeEnum): boolean {
    return this.enabled.some((provider) => provider.code === code);
  }

  get(code: SourceCodeEnum): BaseSourceProvider | undefined {
    return this.enabled.find((provider) => provider.code === code);
  }
}

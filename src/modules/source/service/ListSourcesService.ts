import { Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { Result } from '@/shared/util';
import { SourceCatalogItemDTO } from '@/modules/source/dto';
import { SourceProviderRegistry } from '@/modules/source/registry';

/** Catálogo de fuentes implementadas, cuáles están activas y su estado en vivo (circuito, pausa). */
@Injectable()
export class ListSourcesService extends BaseService<void, SourceCatalogItemDTO[]> {
  constructor(private readonly registry: SourceProviderRegistry) {
    super();
  }

  async execute(): Promise<Result<SourceCatalogItemDTO[]>> {
    const items = this.registry.implemented().map((provider) => ({
      code: provider.code,
      ...provider.info,
      ...provider.runtimeState(this.registry.isEnabled(provider.code)),
    }));
    return Result.success(items, `${items.filter((i) => i.enabled).length} de ${items.length} fuentes activas`);
  }
}

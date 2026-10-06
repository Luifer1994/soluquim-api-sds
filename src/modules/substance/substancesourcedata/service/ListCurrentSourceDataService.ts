import { Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { Result } from '@/shared/util';
import { SourceRecord } from '@/modules/source';
import { SubstanceRepository } from '@/modules/substance/substance/repository';
import { SubstanceSourceDataRepository } from '@/modules/substance/substancesourcedata/repository';

export interface CurrentSourceData {
  cas: string;
  substanceName: string | null;
  sources: Array<{ source: string; status: string; version: number; sourceUrl?: string; records: SourceRecord[] }>;
}

/**
 * Datos VIGENTES guardados de un CAS (sin llamar a ninguna fuente). Lo usan otros módulos (p. ej. la
 * base de conocimiento) para no tocar el repositorio de este módulo.
 */
@Injectable()
export class ListCurrentSourceDataService extends BaseService<{ cas: string; sources?: string[] }, CurrentSourceData> {
  constructor(
    private readonly substances: SubstanceRepository,
    private readonly sourceData: SubstanceSourceDataRepository,
  ) {
    super();
  }

  async execute({ cas, sources }: { cas: string; sources?: string[] }): Promise<Result<CurrentSourceData>> {
    try {
      const [substance, rows] = await Promise.all([this.substances.findByCas(cas), this.sourceData.findByCas(cas)]);
      return Result.success({
        cas,
        substanceName: substance?.name ?? null,
        sources: rows
          .filter((row) => !sources || sources.includes(row.source))
          .map((row) => ({
            source: row.source,
            status: row.status,
            version: row.version,
            sourceUrl: row.rawSnapshot?.url,
            records: row.records as unknown as SourceRecord[],
          })),
      });
    } catch (error) {
      return this.handleException('ListCurrentSourceData', error);
    }
  }
}

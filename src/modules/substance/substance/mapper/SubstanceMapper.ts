import { Substance } from '@prisma/client';
import { SourceStatusEnum } from '@/modules/source';
import { SubstanceResponseDTO, SubstanceSourcesSummaryDTO } from '@/modules/substance/substance/dto/response';
import { SubstanceSourceDataDTO } from '@/modules/substance/substancesourcedata/dto';

export class SubstanceMapper {
  static toResponse(cas: string, substance: Substance | null, sources: SubstanceSourceDataDTO[]): SubstanceResponseDTO {
    return {
      cas,
      name: substance?.name ?? null,
      iupacName: substance?.iupacName ?? null,
      molecularFormula: substance?.formula ?? null,
      synonyms: substance?.synonyms.slice(0, 10) ?? [],
      summary: SubstanceMapper.summarize(sources),
      sources,
    };
  }

  static summarize(sources: SubstanceSourceDataDTO[]): SubstanceSourcesSummaryDTO {
    const count = (predicate: (s: SubstanceSourceDataDTO) => boolean) => sources.filter(predicate).length;
    return {
      total: sources.length,
      ok: count((s) => s.status === SourceStatusEnum.OK),
      notFound: count((s) => s.status === SourceStatusEnum.NOT_FOUND),
      failed: count((s) => s.status === SourceStatusEnum.FAILED || s.status === SourceStatusEnum.CIRCUIT_OPEN),
      pending: count((s) => s.status === SourceStatusEnum.PENDING),
      fromCache: count((s) => s.fromCache),
      stale: count((s) => s.stale),
    };
  }
}

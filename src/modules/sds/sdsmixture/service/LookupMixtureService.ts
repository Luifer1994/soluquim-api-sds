import { HttpStatus, Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { mapWithConcurrency, Result } from '@/shared/util';
import { GetSubstanceByCasService } from '@/modules/substance';
import { LookupMixtureRequestDTO } from '@/modules/sds/sdsmixture/dto/request';
import { MixtureComponentResultDTO, MixtureLookupResponseDTO } from '@/modules/sds/sdsmixture/dto/response';
import { MixtureComponentStatusEnum } from '@/modules/sds/sdsmixture/enums';
import { MixtureNormalizer } from '@/modules/sds/sdsmixture/normalizer';

/** Componentes consultados a la vez. Cada uno ya consulta sus fuentes en paralelo y cada fuente tiene su propio límite. */
const COMPONENT_CONCURRENCY = 4;

/**
 * Consulta una mezcla: normaliza los componentes y trae los datos de cada CAS en todas las fuentes.
 * Un componente que falla no tumba la consulta: queda marcado con su estado y el resto responde.
 */
@Injectable()
export class LookupMixtureService extends BaseService<LookupMixtureRequestDTO, MixtureLookupResponseDTO> {
  constructor(private readonly getSubstanceByCas: GetSubstanceByCasService) {
    super();
  }

  async execute(request: LookupMixtureRequestDTO): Promise<Result<MixtureLookupResponseDTO>> {
    try {
      const mixture = MixtureNormalizer.normalize(request.components);

      const components = await mapWithConcurrency(mixture.components, COMPONENT_CONCURRENCY, async (component) => {
        const result = await this.getSubstanceByCas.execute({ cas: component.cas, refresh: request.refresh });
        return this.toComponentResult(component.cas, component.percentage, result);
      });

      const summary = Object.fromEntries(
        Object.values(MixtureComponentStatusEnum).map((status) => [
          status,
          components.filter((c) => c.status === status).length,
        ]),
      ) as Record<MixtureComponentStatusEnum, number>;

      return Result.success(
        {
          componentCount: components.length,
          totalPercentage: mixture.totalPercentage,
          warnings: this.warnings(mixture.totalPercentage, mixture.mergedDuplicates),
          summary,
          components,
        },
        `Mezcla consultada: ${summary.FOUND + summary.PARTIAL} de ${components.length} componente(s) con datos`,
      );
    } catch (error) {
      return this.handleException('LookupMixture', error);
    }
  }

  private toComponentResult(
    cas: string,
    percentage: number,
    result: Awaited<ReturnType<GetSubstanceByCasService['execute']>>,
  ): MixtureComponentResultDTO {
    const substance = result.data ?? null;
    const status = result.isSuccess
      ? substance && substance.summary.failed > 0
        ? MixtureComponentStatusEnum.PARTIAL
        : MixtureComponentStatusEnum.FOUND
      : result.statusCode === Number(HttpStatus.NOT_FOUND)
        ? MixtureComponentStatusEnum.NOT_FOUND
        : MixtureComponentStatusEnum.UNAVAILABLE;
    return { cas, percentage, status, message: result.message, substance };
  }

  private warnings(total: number, mergedDuplicates: string[]): string[] {
    const warnings = mergedDuplicates.map((cas) => `El CAS ${cas} venía repetido: se sumaron sus porcentajes`);
    if (total < 100) {
      warnings.push(
        `Los componentes suman ${total} %: falta declarar ${Math.round((100 - total) * 10_000) / 10_000} %`,
      );
    }
    return warnings;
  }
}

import { HttpStatus, Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { Result } from '@/shared/util';
import { SubstanceResponseDTO } from '@/modules/substance/substance/dto/response';
import { SubstanceMapper } from '@/modules/substance/substance/mapper';
import { SubstanceRepository } from '@/modules/substance/substance/repository';
import { CollectSubstanceDataService } from '@/modules/substance/substancesourcedata/service';

export interface GetSubstanceByCasInput {
  cas: string;
  refresh?: boolean;
}

/**
 * Consulta un CAS en todas las fuentes (con cache) y arma la respuesta.
 *  - 200: al menos una fuente tiene datos (si alguna falló, el mensaje lo dice y `summary` lo detalla).
 *  - 404: todas las fuentes respondieron que no tienen esa sustancia.
 *  - 502: ninguna fuente pudo consultarse.
 */
@Injectable()
export class GetSubstanceByCasService extends BaseService<GetSubstanceByCasInput, SubstanceResponseDTO> {
  constructor(
    private readonly collect: CollectSubstanceDataService,
    private readonly substances: SubstanceRepository,
  ) {
    super();
  }

  async execute({ cas, refresh }: GetSubstanceByCasInput): Promise<Result<SubstanceResponseDTO>> {
    const collected = await this.collect.execute({ cas, refresh });
    if (!collected.isSuccess || !collected.data) {
      return Result.failure(collected.errorCode ?? 'COLLECT_FAILED', collected.message, collected.statusCode);
    }

    try {
      const substance = await this.substances.findByCas(cas);
      const response = SubstanceMapper.toResponse(cas, substance, collected.data.sources);
      const { total, ok, notFound, failed, pending } = response.summary;

      if (ok === 0 && pending === 0 && notFound === total) {
        return Result.failure(
          'SUBSTANCE_NOT_FOUND',
          `El CAS ${cas} no se encontró en ninguna fuente`,
          HttpStatus.NOT_FOUND,
          response,
        );
      }
      if (ok === 0 && failed > 0) {
        return Result.failure(
          'SOURCES_UNAVAILABLE',
          'No se pudo consultar ninguna fuente; intente de nuevo',
          HttpStatus.BAD_GATEWAY,
          response,
        );
      }
      const notes = [
        failed > 0 ? `${failed} fuente(s) no respondieron` : '',
        pending > 0 ? `${pending} fuente(s) se están consultando en segundo plano` : '',
      ].filter(Boolean);
      const message = notes.length ? `Consulta parcial: ${notes.join('; ')}` : 'Sustancia consultada correctamente';
      return Result.success(response, message);
    } catch (error) {
      return this.handleException('GetSubstanceByCas', error);
    }
  }
}

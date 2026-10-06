import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '@/shared/http';
import { Result } from '@/shared/util';
import {
  GetSubstanceParamsDTO,
  GetSubstanceParamsSchema,
  GetSubstanceQueryDTO,
  GetSubstanceQuerySchema,
} from '@/modules/substance/substance/dto/request';
import { SubstanceResponseDTO } from '@/modules/substance/substance/dto/response';
import { GetSubstanceByCasService } from '@/modules/substance/substance/service';

// Sin @RequirePermission por ahora: la ruta del gateway aún no autentica (ver README).
@ApiTags('Sustancias')
@Controller('v1/substances')
export class SubstanceController {
  constructor(private readonly getSubstanceByCas: GetSubstanceByCasService) {}

  @Get(':cas')
  @ApiOperation({
    summary: 'Consultar una sustancia por CAS en todas las fuentes',
    description:
      'Devuelve los datos normalizados de cada fuente (PubChem, NIOSH), con cache en la BD. ' +
      'Si una fuente falla, el resto responde igual y `summary` indica qué pasó.',
  })
  @ApiParam({ name: 'cas', example: '64-17-5', description: 'Número CAS (se valida el dígito verificador)' })
  @ApiQuery({ name: 'refresh', required: false, example: false, description: 'true = ignorar el cache' })
  find(
    @Param(new ZodValidationPipe(GetSubstanceParamsSchema)) params: GetSubstanceParamsDTO,
    @Query(new ZodValidationPipe(GetSubstanceQuerySchema)) query: GetSubstanceQueryDTO,
  ): Promise<Result<SubstanceResponseDTO>> {
    return this.getSubstanceByCas.execute({ cas: params.cas, refresh: query.refresh });
  }
}

import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '@/shared/http';
import { Result } from '@/shared/util';
import {
  LookupMixtureQuerySchema,
  LookupMixtureRequestDTO,
  LookupMixtureRequestSchema,
} from '@/modules/sds/sdsmixture/dto/request';
import { MixtureLookupResponseDTO } from '@/modules/sds/sdsmixture/dto/response';
import { LookupMixtureService } from '@/modules/sds/sdsmixture/service';

const EXAMPLE = {
  components: [
    { cas: '64-17-5', percentage: 70 },
    { cas: '7732-18-5', percentage: 30 },
  ],
};

// Sin @RequirePermission por ahora: la ruta del gateway aún no autentica (ver README).
@ApiTags('Mezclas')
@Controller('v1/mixtures')
export class SdsMixtureController {
  constructor(private readonly lookupMixture: LookupMixtureService) {}

  @Post('lookup')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Consultar una mezcla (varios componentes con CAS y porcentaje)',
    description:
      'Normaliza la mezcla (CAS repetidos se suman, orden por porcentaje) y trae los datos de cada ' +
      'componente en todas las fuentes. La suma de porcentajes no puede superar 100 %.',
  })
  @ApiBody({ schema: { example: EXAMPLE } })
  lookupPost(
    @Body(new ZodValidationPipe(LookupMixtureRequestSchema)) body: LookupMixtureRequestDTO,
  ): Promise<Result<MixtureLookupResponseDTO>> {
    return this.lookupMixture.execute(body);
  }

  @Get('lookup')
  @ApiOperation({ summary: 'Consultar una mezcla por query string (para probar desde el navegador)' })
  @ApiQuery({
    name: 'components',
    example: '64-17-5:70,7732-18-5:30',
    description: 'cas:porcentaje separados por coma',
  })
  @ApiQuery({ name: 'refresh', required: false, example: false })
  lookupGet(
    @Query(new ZodValidationPipe(LookupMixtureQuerySchema)) query: LookupMixtureRequestDTO,
  ): Promise<Result<MixtureLookupResponseDTO>> {
    return this.lookupMixture.execute(query);
  }
}

import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '@/shared/http';
import { Result } from '@/shared/util';
import {
  GenerateSdsRequestDTO,
  GenerateSdsRequestSchema,
  JobIdParamsSchema,
} from '@/modules/sds/sdsgeneration/dto/request';
import { SdsGenerationJobResponseDTO } from '@/modules/sds/sdsgeneration/dto/response';
import { GetSdsGenerationJobService, RequestSdsGenerationService } from '@/modules/sds/sdsgeneration/service';

const EXAMPLE = {
  components: [
    { cas: '64-17-5', percentage: 70 },
    { cas: '7732-18-5', percentage: 30 },
  ],
  language: 'es',
  destinationCountry: 'CO',
  product: { name: 'Alcohol antiséptico 70 %' },
};

// Sin @RequirePermission por ahora: la ruta del gateway aún no autentica (ver README).
@ApiTags('FDS — generación con IA')
@Controller('v1/generations')
export class SdsGenerationController {
  constructor(
    private readonly requestGeneration: RequestSdsGenerationService,
    private readonly getJob: GetSdsGenerationJobService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Generar el borrador de una FDS con el agente (asíncrono)',
    description:
      'Responde 202 con un jobId. Consultar GET /generations/{jobId} hasta COMPLETED/PARTIAL y leer el documento.',
  })
  @ApiBody({ schema: { example: EXAMPLE } })
  generate(
    @Body(new ZodValidationPipe(GenerateSdsRequestSchema)) body: GenerateSdsRequestDTO,
  ): Promise<Result<{ jobId: string; status: string }>> {
    return this.requestGeneration.execute(body);
  }

  @Get(':jobId')
  @ApiOperation({ summary: 'Estado de una generación' })
  status(
    @Param(new ZodValidationPipe(JobIdParamsSchema)) params: { jobId: string },
  ): Promise<Result<SdsGenerationJobResponseDTO>> {
    return this.getJob.execute({ jobId: params.jobId });
  }
}

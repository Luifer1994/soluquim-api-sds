import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '@/shared/http';
import { Result } from '@/shared/util';
import {
  ListSdsDocumentsQueryDTO,
  ListSdsDocumentsQuerySchema,
  SdsDocumentFieldParamsDTO,
  SdsDocumentFieldParamsSchema,
  SdsDocumentIdParamsDTO,
  SdsDocumentIdParamsSchema,
  UpdateSdsDocumentFieldDTO,
  UpdateSdsDocumentFieldSchema,
} from '@/modules/sds/sdsdocument/dto/request';
import { SdsDocumentSummaryDTO, SdsSectionDTO } from '@/modules/sds/sdsdocument/dto/response';
import {
  GetSdsDocumentByIdService,
  ListSdsDocumentsService,
  SdsDocumentResponseDTO,
  UpdateSdsDocumentFieldService,
} from '@/modules/sds/sdsdocument/service';

// Sin @RequirePermission por ahora: la ruta del gateway aún no autentica (ver README).
@ApiTags('FDS — documentos')
@Controller('v1/documents')
export class SdsDocumentController {
  constructor(
    private readonly getById: GetSdsDocumentByIdService,
    private readonly list: ListSdsDocumentsService,
    private readonly updateField: UpdateSdsDocumentFieldService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'FDS más recientes (resumen, sin las secciones)' })
  recent(
    @Query(new ZodValidationPipe(ListSdsDocumentsQuerySchema)) query: ListSdsDocumentsQueryDTO,
  ): Promise<Result<SdsDocumentSummaryDTO[]>> {
    return this.list.execute({ limit: query.limit });
  }

  @Get(':id')
  @ApiOperation({ summary: 'FDS generada: por sección, los campos de la plantilla y lo que encontró cada fuente' })
  find(
    @Param(new ZodValidationPipe(SdsDocumentIdParamsSchema)) params: SdsDocumentIdParamsDTO,
  ): Promise<Result<SdsDocumentResponseDTO>> {
    return this.getById.execute({ id: params.id });
  }

  @Patch(':id/sections/:number/fields/:key')
  @ApiOperation({
    summary: 'Editar un campo de una sección',
    description:
      'Texto del revisor, o el dato de una de las fuentes de esa sección (`source`). `value` null lo deja vacío.',
  })
  @ApiBody({ schema: { example: { value: 'Líquido incoloro', source: { source: 'ICSC', cas: '64-17-5' } } } })
  update(
    @Param(new ZodValidationPipe(SdsDocumentFieldParamsSchema)) params: SdsDocumentFieldParamsDTO,
    @Body(new ZodValidationPipe(UpdateSdsDocumentFieldSchema)) body: UpdateSdsDocumentFieldDTO,
  ): Promise<Result<SdsSectionDTO>> {
    return this.updateField.execute({ ...params, ...body });
  }
}

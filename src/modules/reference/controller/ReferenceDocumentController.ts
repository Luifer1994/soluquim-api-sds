import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ZodValidationPipe } from '@/shared/http';
import { Result } from '@/shared/util';
import {
  ListReferenceDocumentsQueryDTO,
  ListReferenceDocumentsQuerySchema,
  ReferenceDocumentIdParamsDTO,
  ReferenceDocumentIdParamsSchema,
  UpdateReferenceDocumentDTO,
  UpdateReferenceDocumentSchema,
  UploadedReferenceFile,
  UploadReferenceDocumentDTO,
  UploadReferenceDocumentSchema,
} from '@/modules/reference/dto/request';
import { ReferenceDocumentOptionsDTO, ReferenceDocumentResponseDTO } from '@/modules/reference/dto/response';
import {
  DeleteReferenceDocumentService,
  DownloadReferenceDocumentService,
  GetReferenceDocumentOptionsService,
  ListReferenceDocumentsService,
  ReindexReferenceDocumentService,
  UpdateReferenceDocumentService,
  UploadReferenceDocumentService,
} from '@/modules/reference/service';

/** Tope duro de multer; el máximo real lo valida el servicio con REFERENCE_MAX_UPLOAD_MB. */
const MULTER_MAX_BYTES = 200 * 1024 * 1024;

// Sin @RequirePermission por ahora: la ruta del gateway aún no autentica (ver README).
@ApiTags('Documentación de referencia (RAG general)')
@Controller('v1/reference-documents')
export class ReferenceDocumentController {
  constructor(
    private readonly list: ListReferenceDocumentsService,
    private readonly options: GetReferenceDocumentOptionsService,
    private readonly upload: UploadReferenceDocumentService,
    private readonly update: UpdateReferenceDocumentService,
    private readonly remove: DeleteReferenceDocumentService,
    private readonly reindex: ReindexReferenceDocumentService,
    private readonly download: DownloadReferenceDocumentService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Documentos cargados con su estado de indexación',
    description:
      'Por defecto la biblioteca. `?scope=PRODUCT&ids=a,b` para seguir los documentos adjuntos a una generación.',
  })
  findAll(
    @Query(new ZodValidationPipe(ListReferenceDocumentsQuerySchema)) query: ListReferenceDocumentsQueryDTO,
  ): Promise<Result<ReferenceDocumentResponseDTO[]>> {
    return this.list.execute(query);
  }

  @Get('options')
  @ApiOperation({ summary: 'Formatos aceptados, tamaño máximo y categorías' })
  findOptions(): Promise<Result<ReferenceDocumentOptionsDTO>> {
    return this.options.execute();
  }

  @Post()
  @HttpCode(202)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Subir un documento de referencia',
    description:
      'Multipart: `file` + `title`, `category`, `language`, `description`, `sdsSections` ("4,5,6"; vacío = todas), ' +
      '`scope` (LIBRARY = biblioteca que se consulta siempre; PRODUCT = documento del producto que se adjunta a una ' +
      'generación) y `cas` (componente que describe un documento del producto). Responde 202: el worker extrae el ' +
      'texto, lo fragmenta y lo vectoriza.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'title'],
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string', example: 'Guía de Respuesta en caso de Emergencia (GRE) 2024' },
        category: { type: 'string', example: 'GUIDE' },
        language: { type: 'string', example: 'es' },
        description: { type: 'string' },
        sdsSections: { type: 'string', example: '4,5,6,14' },
        scope: { type: 'string', example: 'LIBRARY' },
        cas: { type: 'string', example: '64-17-5' },
      },
    },
  })
  create(
    @UploadedFile() file: UploadedReferenceFile | undefined,
    @Body(new ZodValidationPipe(UploadReferenceDocumentSchema)) metadata: UploadReferenceDocumentDTO,
  ): Promise<Result<ReferenceDocumentResponseDTO>> {
    return this.upload.execute({ file, metadata });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar título, descripción, categoría, idioma o secciones del documento' })
  edit(
    @Param(new ZodValidationPipe(ReferenceDocumentIdParamsSchema)) params: ReferenceDocumentIdParamsDTO,
    @Body(new ZodValidationPipe(UpdateReferenceDocumentSchema)) body: UpdateReferenceDocumentDTO,
  ): Promise<Result<ReferenceDocumentResponseDTO>> {
    return this.update.execute({ id: params.id, ...body });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar el documento (archivo y fragmentos): deja de consultarse' })
  delete(
    @Param(new ZodValidationPipe(ReferenceDocumentIdParamsSchema)) params: ReferenceDocumentIdParamsDTO,
  ): Promise<Result<void>> {
    return this.remove.execute({ id: params.id });
  }

  @Post(':id/reindex')
  @HttpCode(202)
  @ApiOperation({ summary: 'Volver a indexar el documento desde su archivo' })
  requeue(
    @Param(new ZodValidationPipe(ReferenceDocumentIdParamsSchema)) params: ReferenceDocumentIdParamsDTO,
  ): Promise<Result<ReferenceDocumentResponseDTO>> {
    return this.reindex.execute({ id: params.id });
  }

  @Get(':id/file')
  @ApiOperation({ summary: 'Descargar el archivo original' })
  async file(
    @Param(new ZodValidationPipe(ReferenceDocumentIdParamsSchema)) params: ReferenceDocumentIdParamsDTO,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | Result<unknown>> {
    const result = await this.download.execute({ id: params.id });
    if (!result.isSuccess || !result.data) return result;
    const { fileName, mimeType, content } = result.data;
    response.setHeader('Content-Type', mimeType);
    response.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return new StreamableFile(content);
  }
}

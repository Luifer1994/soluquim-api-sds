import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '@/shared/http';
import { Result } from '@/shared/util';
import {
  CasParamsDTO,
  CasParamsSchema,
  SearchKnowledgeQueryDTO,
  SearchKnowledgeQuerySchema,
  SyncKnowledgeRequestDTO,
  SyncKnowledgeRequestSchema,
} from '@/modules/knowledge/dto/request';
import { KnowledgeSearchHit } from '@/modules/knowledge/repository';
import {
  IndexSubstanceKnowledgeResult,
  IndexSubstanceKnowledgeService,
  SearchKnowledgeService,
  SyncedSubstance,
  SyncSubstanceKnowledgeService,
} from '@/modules/knowledge/service';

// Sin @RequirePermission por ahora: la ruta del gateway aún no autentica (ver README).
@ApiTags('Base de conocimiento (RAG)')
@Controller('v1/knowledge')
export class KnowledgeController {
  constructor(
    private readonly search: SearchKnowledgeService,
    private readonly index: IndexSubstanceKnowledgeService,
    private readonly sync: SyncSubstanceKnowledgeService,
  ) {}

  @Post('sync')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Dejar al día datos + RAG de un CAS o de los componentes de una mezcla',
    description:
      'Base local primero: solo consulta una fuente si no hay dato o venció (refresh=true fuerza todas). Guarda versión nueva si el contenido cambió y vectoriza solo lo nuevo.',
  })
  syncSubstances(
    @Body(new ZodValidationPipe(SyncKnowledgeRequestSchema)) body: SyncKnowledgeRequestDTO,
  ): Promise<Result<SyncedSubstance[]>> {
    const casList = [...(body.cas ? [body.cas] : []), ...(body.components ?? []).map((c) => c.cas)];
    return this.sync.execute({ casList, refresh: body.refresh });
  }

  @Get('search')
  @ApiOperation({ summary: 'Buscar en la base de conocimiento (lo mismo que ve el agente)' })
  find(
    @Query(new ZodValidationPipe(SearchKnowledgeQuerySchema)) query: SearchKnowledgeQueryDTO,
  ): Promise<Result<KnowledgeSearchHit[]>> {
    return this.search.execute({ casList: query.cas, sections: query.sections, query: query.q, perCas: query.perCas });
  }

  @Post(':cas/reindex')
  @ApiOperation({ summary: 'Reconstruir la base de conocimiento de un CAS desde sus datos guardados' })
  reindex(
    @Param(new ZodValidationPipe(CasParamsSchema)) params: CasParamsDTO,
  ): Promise<Result<IndexSubstanceKnowledgeResult>> {
    return this.index.execute({ cas: params.cas });
  }
}

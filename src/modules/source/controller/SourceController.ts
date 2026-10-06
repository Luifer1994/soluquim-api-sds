import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Result } from '@/shared/util';
import { SourceCatalogItemDTO } from '@/modules/source/dto';
import { ListSourcesService } from '@/modules/source/service';

@ApiTags('Fuentes')
@Controller('v1/sources')
export class SourceController {
  constructor(private readonly listSources: ListSourcesService) {}

  @Get()
  @ApiOperation({ summary: 'Fuentes de datos: cuáles hay, cuáles están activas y su estado (circuito, pausa)' })
  list(): Promise<Result<SourceCatalogItemDTO[]>> {
    return this.listSources.execute();
  }
}

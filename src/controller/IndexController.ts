import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Result } from '@/shared/util';

/** `GET /` — respuesta básica para saber que el servicio está arriba, igual que el IndexController de los micros Java. */
@ApiExcludeController()
@Controller()
export class IndexController {
  @Get()
  index(): Result<null> {
    return Result.success(null, 'Soluquim SDS API Service is running!');
  }
}

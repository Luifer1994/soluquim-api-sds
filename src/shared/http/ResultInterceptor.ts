import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { map, Observable } from 'rxjs';
import { buildApiResponse, Result } from '@/shared/util';

/**
 * Los controllers retornan el `Result` del service; aquí se convierte en status HTTP + sobre estándar.
 * Si un handler retorna otra cosa (p. ej. un stream), se deja pasar tal cual.
 */
@Injectable()
export class ResultInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResultInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        if (!(value instanceof Result)) return value;

        if (!value.isSuccess) {
          this.logger.warn(`Result failure: ${value.errorCode} (${value.statusCode}) — ${value.message}`);
        }
        context.switchToHttp().getResponse<Response>().status(value.statusCode);
        return buildApiResponse(value.statusCode, value.message, value.data);
      }),
    );
  }
}

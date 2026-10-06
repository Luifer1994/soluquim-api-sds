import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { buildApiResponse } from '@/shared/util';
import { BusinessException } from '@/shared/exception/BusinessException';

const DEFAULT_MESSAGES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Solicitud inválida',
  [HttpStatus.UNAUTHORIZED]: 'No autenticado',
  [HttpStatus.FORBIDDEN]: 'No tiene permisos para realizar esta acción',
  [HttpStatus.NOT_FOUND]: 'Recurso no encontrado',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'Método no permitido',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'La solicitud es demasiado grande',
};

/** Todo error sale con el sobre estándar `{ timestamp, status, message, data }`. Nunca se envía el stack. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, message, data } = this.resolve(exception);

    if (status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(err.message, err.stack);
    }

    response.status(status).json(buildApiResponse(status, message, data));
  }

  private resolve(exception: unknown): { status: number; message: string; data?: unknown } {
    if (exception instanceof BusinessException) {
      return { status: exception.statusCode, message: exception.message, data: exception.data };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      // Nest solo agrega `error` al body cuando el código pasó un mensaje propio (`new ForbiddenException('…')`).
      // Sin él, el mensaje es el genérico en inglés ("Forbidden", "Cannot GET /x"): usamos el nuestro.
      const hasCustomMessage = typeof body === 'object' && body !== null && 'error' in body;
      const custom = hasCustomMessage ? (body as { message?: unknown }).message : undefined;
      const isRouteNotFound = typeof custom === 'string' && /^Cannot [A-Z]+ /.test(custom);
      const message =
        typeof custom === 'string' && !isRouteNotFound ? custom : (DEFAULT_MESSAGES[status] ?? 'Ocurrió un error');
      return { status, message };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Ocurrió un error interno en el servidor' };
  }
}

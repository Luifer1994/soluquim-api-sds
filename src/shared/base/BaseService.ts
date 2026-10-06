import { Logger } from '@nestjs/common';
import { Result } from '@/shared/util';

/**
 * Base de todos los casos de uso: una clase por acción (`<Acción><Concepto>Service`) con un único
 * punto de entrada `execute()`.
 */
export abstract class BaseService<TRequest, TResponse> {
  protected readonly logger = new Logger(this.constructor.name);

  abstract execute(request: TRequest): Promise<Result<TResponse>>;

  /** Registra el error completo y devuelve un 500 genérico: el detalle interno nunca llega al cliente. */
  protected handleException(operation: string, error: unknown): Result<never> {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(`[${operation}] ${err.message}`, err.stack);
    return Result.failure('INTERNAL_ERROR', 'Ocurrió un error interno en el servidor', 500);
  }
}

import { BusinessException } from '@/shared/exception/BusinessException';

/** 422 con el detalle por campo en `data` — mismo contrato que el GlobalExceptionHandler de Java. */
export class ValidationException extends BusinessException {
  constructor(errors: Record<string, string>) {
    super('Error de validación en los datos enviados', 422, errors);
    this.name = 'ValidationException';
  }
}

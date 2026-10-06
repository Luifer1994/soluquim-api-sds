/**
 * Resultado de un caso de uso. Los services no lanzan excepciones de negocio: devuelven un Result
 * y el ResultInterceptor lo traduce al sobre HTTP estándar de Soluquim.
 */
export class Result<T = unknown> {
  private constructor(
    public readonly isSuccess: boolean,
    public readonly statusCode: number,
    public readonly message: string,
    public readonly data?: T,
    /** Código interno del error. Va al log, no al cliente. */
    public readonly errorCode?: string,
  ) {}

  static success<T>(data?: T, message = 'Operación exitosa', statusCode = 200): Result<T> {
    return new Result<T>(true, statusCode, message, data);
  }

  static created<T>(data: T, message = 'Registro creado correctamente'): Result<T> {
    return new Result<T>(true, 201, message, data);
  }

  static accepted<T>(data: T, message = 'Solicitud en proceso'): Result<T> {
    return new Result<T>(true, 202, message, data);
  }

  static failure<T = never>(errorCode: string, message = 'Ocurrió un error', statusCode = 400, data?: T): Result<T> {
    return new Result<T>(false, statusCode, message, data, errorCode);
  }
}

/**
 * Error de negocio que debe llegar al cliente con su status y mensaje. Para flujos esperados se
 * prefiere devolver `Result.failure`; esto es para cortar desde capas profundas (repositorio, cliente).
 */
export class BusinessException extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'BusinessException';
  }
}

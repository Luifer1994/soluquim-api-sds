/** La fuente respondió bien pero no tiene la sustancia. No se reintenta y se cachea como NOT_FOUND. */
export class SubstanceNotFoundInSourceError extends Error {
  constructor(source: string, cas: string) {
    super(`${source} no tiene datos para el CAS ${cas}`);
    this.name = 'SubstanceNotFoundInSourceError';
  }
}

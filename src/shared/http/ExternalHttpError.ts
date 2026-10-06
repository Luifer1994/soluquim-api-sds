/** Respuesta HTTP no exitosa de un sistema externo. */
export class ExternalHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    detail?: string,
    /** Segundos que la fuente pide esperar (header Retry-After), si lo mandó. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(`HTTP ${status} en ${url}${detail ? `: ${detail}` : ''}`);
    this.name = 'ExternalHttpError';
  }

  /**
   * 429 y 5xx son transitorios (vale la pena reintentar); el resto de 4xx no. Si la fuente pidió
   * esperar (Retry-After), tampoco se reintenta en el momento: se respeta la pausa.
   */
  get isRetryable(): boolean {
    return (this.status === 429 || this.status >= 500) && this.retryAfterSeconds === undefined;
  }
}

/** Retry-After puede venir en segundos ("30") o como fecha HTTP. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

import { Injectable } from '@nestjs/common';
import { ExternalHttpError, parseRetryAfter } from '@/shared/http/ExternalHttpError';

const USER_AGENT = 'Soluquim-SDS/0.1 (+https://soluquim.co; sistemas@mejoraysoluciones.com)';

export interface ExternalResponse<T> {
  url: string;
  status: number;
  contentType: string;
  body: T;
  /** Cuerpo tal cual llegó, para guardarlo como snapshot crudo. */
  raw: string;
}

/**
 * Cliente HTTP para fuentes externas (fetch nativo). No reintenta: los reintentos, timeouts y
 * circuit breaker los aplica la política de resiliencia de quien lo usa. Solo:
 *  - se identifica con un User-Agent propio (buena práctica con APIs públicas),
 *  - respeta la señal de cancelación del timeout,
 *  - convierte los status no-2xx en ExternalHttpError (con el Retry-After si la fuente lo manda).
 */
@Injectable()
export class ExternalHttpClient {
  async getText(url: string, signal?: AbortSignal, accept = 'text/html'): Promise<ExternalResponse<string>> {
    const response = await fetch(url, { signal, headers: { 'User-Agent': USER_AGENT, Accept: accept } });
    const raw = await response.text();
    if (!response.ok) {
      throw new ExternalHttpError(
        response.status,
        url,
        raw.slice(0, 200),
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }
    return { url, status: response.status, contentType: response.headers.get('content-type') ?? '', body: raw, raw };
  }

  async getJson<T>(url: string, signal?: AbortSignal): Promise<ExternalResponse<T>> {
    const response = await this.getText(url, signal, 'application/json');
    if (!response.raw.trim()) throw new ExternalHttpError(502, url, 'respuesta vacía');
    try {
      return { ...response, body: JSON.parse(response.raw) as T };
    } catch {
      throw new ExternalHttpError(502, url, 'JSON inválido');
    }
  }
}

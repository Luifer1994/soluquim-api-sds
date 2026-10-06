/**
 * Sobre de respuesta estándar de Soluquim — mismo formato que `HttpResponse` de soluquim-commons (Java).
 */
export interface ApiResponse<T = unknown> {
  timestamp: string;
  status: number;
  message: string;
  data: T | null;
}

export function buildApiResponse<T>(status: number, message: string, data?: T): ApiResponse<T> {
  return {
    timestamp: new Date().toISOString(),
    status,
    message,
    data: data ?? null,
  };
}

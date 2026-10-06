/** Error de una operación que no terminó dentro de su tiempo límite. */
export class DeadlineExceededError extends Error {
  constructor(label: string, ms: number) {
    super(`${label}: sin respuesta en ${Math.round(ms / 1000)} s`);
    this.name = 'DeadlineExceededError';
  }
}

/**
 * Espera una promesa como máximo `ms`. Si no termina, rechaza con DeadlineExceededError (la operación
 * original puede seguir en segundo plano: esto solo garantiza que quien espera no se quede colgado).
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(label, ms)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

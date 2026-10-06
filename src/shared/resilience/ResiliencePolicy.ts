import {
  BulkheadPolicy,
  CircuitBreakerPolicy,
  bulkhead,
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleWhen,
  IPolicy,
  retry,
  timeout,
  TimeoutStrategy,
  wrap,
} from 'cockatiel';

export interface ResilienceOptions {
  /** Tiempo máximo por intento. */
  timeoutMs: number;
  /** Intentos TOTALES, incluido el primero. */
  maxAttempts: number;
  /** Llamadas simultáneas máximas al mismo destino (bulkhead). */
  maxConcurrent: number;
  /** Llamadas que pueden esperar turno en el bulkhead antes de rechazarse. */
  maxQueued: number;
  /** Fallos consecutivos para abrir el circuito. */
  breakAfter: number;
  /** Tiempo con el circuito abierto antes de probar de nuevo. */
  halfOpenAfterMs: number;
  /** Errores que NO deben reintentarse (p. ej. "no encontrado"). */
  isNonRetryable?: (error: Error) => boolean;
}

export const DEFAULT_RESILIENCE: ResilienceOptions = {
  timeoutMs: 8_000,
  maxAttempts: 3,
  maxConcurrent: 2,
  maxQueued: 50,
  breakAfter: 5,
  halfOpenAfterMs: 60_000,
};

export interface ResiliencePolicy {
  policy: IPolicy;
  /** Expuesto para consultar su estado (abierto/cerrado) en el endpoint de fuentes. */
  breaker: CircuitBreakerPolicy;
  bulkhead: BulkheadPolicy;
}

/**
 * Política para llamadas a sistemas externos: bulkhead → circuit breaker → retry con backoff → timeout.
 * Crear UNA por destino y reutilizarla: el circuito y el bulkhead guardan estado entre llamadas.
 */
export function buildResiliencePolicy(overrides: Partial<ResilienceOptions> = {}): ResiliencePolicy {
  const options = { ...DEFAULT_RESILIENCE, ...overrides };
  const isRetryable = handleWhen((error) => !options.isNonRetryable?.(error));

  const perAttemptTimeout = timeout(options.timeoutMs, TimeoutStrategy.Aggressive);
  const retryPolicy = retry(isRetryable, {
    maxAttempts: options.maxAttempts - 1,
    backoff: new ExponentialBackoff({ initialDelay: 500, maxDelay: 5_000 }),
  });
  const breaker = circuitBreaker(isRetryable, {
    halfOpenAfter: options.halfOpenAfterMs,
    breaker: new ConsecutiveBreaker(options.breakAfter),
  });
  const limiter = bulkhead(options.maxConcurrent, options.maxQueued);

  return { policy: wrap(limiter, breaker, retryPolicy, perAttemptTimeout), breaker, bulkhead: limiter };
}

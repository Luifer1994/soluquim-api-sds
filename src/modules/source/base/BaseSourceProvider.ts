import { Logger } from '@nestjs/common';
import { BrokenCircuitError, CircuitState } from 'cockatiel';
import { ExternalHttpError } from '@/shared/http';
import { buildResiliencePolicy, ResilienceOptions, ResiliencePolicy } from '@/shared/resilience';
import {
  RawSourcePayload,
  SourceFetchResult,
  SourceInfo,
  SourceRecord,
  SourceRuntimeState,
} from '@/modules/source/dto';
import { SourceCodeEnum, SourceStatusEnum } from '@/modules/source/enums';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';

/** Lo que implementa cada fuente: traer los datos y mapearlos al formato común. */
export interface SourceFetchOutput {
  records: SourceRecord[];
  sourceUrl: string;
  raw: RawSourcePayload;
}

/**
 * Base de todas las fuentes (patrón Template Method). Cada fuente implementa SOLO `performFetch`;
 * la base aplica resiliencia (bulkhead → circuit breaker → retry con backoff → timeout), mide el
 * tiempo y convierte cualquier resultado en un SourceFetchResult. Nunca lanza: si la fuente falla,
 * devuelve status FAILED / CIRCUIT_OPEN y el resto de fuentes sigue.
 */
export abstract class BaseSourceProvider {
  protected readonly logger = new Logger(this.constructor.name);
  abstract readonly code: SourceCodeEnum;
  abstract readonly info: SourceInfo;
  /** Cuántos días es válido un dato de esta fuente en el cache. */
  abstract readonly cacheTtlDays: number;
  /**
   * Fecha desde la que esta fuente extrae más (o distinto): lo guardado ANTES se vuelve a consultar aunque
   * no haya vencido su caché. Se actualiza al ampliar el parser, para no esperar el TTL.
   */
  readonly extractionUpdatedAt?: Date;
  /** Días que se cachea un "no encontrado" (la fuente puede agregar la sustancia después). */
  readonly notFoundTtlDays: number = 7;
  /**
   * `inline`: se consulta dentro de la petición HTTP.
   * `background`: la fuente es lenta por diseño (crawl-delay): si no hay cache, la consulta la hace el
   * worker en segundo plano y la respuesta HTTP devuelve PENDING.
   */
  readonly mode: 'inline' | 'background' = 'inline';
  /**
   * Si entra con `SOURCES_ENABLED=*`. Una fuente con un problema conocido (p. ej. bloqueo del sitio)
   * queda en `false` y solo se activa nombrándola explícitamente en SOURCES_ENABLED.
   */
  readonly enabledByDefault: boolean = true;

  private resiliencePolicy?: ResiliencePolicy;
  /** Hasta cuándo no se llama a la fuente porque pidió esperar (Retry-After). */
  private pausedUntil = 0;

  /** Ajustes de resiliencia propios de la fuente (límites de la API, lentitud…). */
  protected resilience(): Partial<ResilienceOptions> {
    return {};
  }

  protected abstract performFetch(cas: string, signal: AbortSignal): Promise<SourceFetchOutput>;

  /** La política se crea una sola vez por fuente: el circuito y el bulkhead guardan estado entre llamadas. */
  private get policy(): ResiliencePolicy {
    this.resiliencePolicy ??= buildResiliencePolicy({
      ...this.resilience(),
      // "No encontrado" y los 4xx (salvo 429) son respuestas definitivas: reintentar no cambia nada.
      isNonRetryable: (error) =>
        error instanceof SubstanceNotFoundInSourceError || (error instanceof ExternalHttpError && !error.isRetryable),
    });
    return this.resiliencePolicy;
  }

  runtimeState(enabled: boolean): SourceRuntimeState {
    const circuit = {
      [CircuitState.Closed]: 'closed',
      [CircuitState.Open]: 'open',
      [CircuitState.HalfOpen]: 'halfOpen',
      [CircuitState.Isolated]: 'isolated',
    } as const;
    return {
      enabled,
      circuit: circuit[this.policy.breaker.state],
      pausedUntil: this.pausedUntil > Date.now() ? new Date(this.pausedUntil).toISOString() : undefined,
      cacheTtlDays: this.cacheTtlDays,
      notFoundTtlDays: this.notFoundTtlDays,
      mode: this.mode,
    };
  }

  async fetch(cas: string): Promise<SourceFetchResult> {
    const startedAt = Date.now();
    const base = { source: this.code, cas, retrievedAt: new Date() };

    // La fuente pidió esperar: se respeta sin llamarla (insistir solo alarga el bloqueo).
    if (startedAt < this.pausedUntil) {
      const seconds = Math.ceil((this.pausedUntil - startedAt) / 1000);
      const error = `${this.code} pidió esperar (Retry-After): se reintenta en ${seconds} s`;
      return { ...base, status: SourceStatusEnum.CIRCUIT_OPEN, records: [], durationMs: 0, error };
    }

    try {
      const output = await this.policy.policy.execute(({ signal }) => this.performFetch(cas, signal));
      return { ...base, status: SourceStatusEnum.OK, ...output, durationMs: Date.now() - startedAt };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (error instanceof SubstanceNotFoundInSourceError) {
        return { ...base, status: SourceStatusEnum.NOT_FOUND, records: [], durationMs };
      }
      if (error instanceof ExternalHttpError && error.retryAfterSeconds !== undefined) {
        this.pausedUntil = Date.now() + error.retryAfterSeconds * 1000;
        this.logger.warn(`${this.code} pidió esperar ${error.retryAfterSeconds} s (HTTP ${error.status}): pausada`);
      }
      const status = error instanceof BrokenCircuitError ? SourceStatusEnum.CIRCUIT_OPEN : SourceStatusEnum.FAILED;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${this.code} ${status} para CAS ${cas} (${durationMs} ms): ${message}`);
      return { ...base, status, records: [], durationMs, error: message };
    }
  }
}

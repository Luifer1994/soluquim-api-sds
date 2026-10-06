import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Garantiza un mínimo de tiempo entre llamadas sucesivas (p. ej. el `Crawl-delay: 10` de OSHA).
 * Las llamadas se encolan en orden; cada una espera su turno. Una instancia por destino y proceso.
 */
export class MinIntervalLimiter {
  private next = 0;

  constructor(private readonly intervalMs: number) {}

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const slot = Math.max(now, this.next);
    this.next = slot + this.intervalMs;
    if (slot > now) await sleep(slot - now);
    return fn();
  }
}

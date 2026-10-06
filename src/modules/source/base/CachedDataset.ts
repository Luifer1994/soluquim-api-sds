import { SingleFlight } from '@/shared/util';

/**
 * Un conjunto de datos que se descarga COMPLETO (índice, CSV, JS con datos…) y se consulta en memoria.
 * Se refresca cuando vence; si llegan varias consultas mientras se descarga, comparten la descarga.
 * Si refrescar falla y ya había una versión, se sigue usando la anterior (stale-if-error).
 */
export class CachedDataset<T> {
  private value?: { data: T; loadedAt: number };
  private readonly loading = new SingleFlight<T>();

  constructor(
    private readonly ttlMs: number,
    private readonly load: (signal?: AbortSignal) => Promise<T>,
  ) {}

  async get(signal?: AbortSignal): Promise<T> {
    if (this.value && Date.now() - this.value.loadedAt < this.ttlMs) return this.value.data;

    try {
      return await this.loading.run('dataset', async () => {
        const data = await this.load(signal);
        this.value = { data, loadedAt: Date.now() };
        return data;
      });
    } catch (error) {
      if (this.value) return this.value.data;
      throw error;
    }
  }
}

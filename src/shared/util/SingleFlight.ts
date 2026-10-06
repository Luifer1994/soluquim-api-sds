/**
 * Evita trabajo duplicado: si llegan varias llamadas con la misma clave mientras la primera está en
 * curso, todas comparten esa misma promesa en vez de lanzar una nueva (p. ej. dos requests por el
 * mismo CAS a la vez → una sola consulta a la fuente).
 */
export class SingleFlight<T> {
  private readonly inFlight = new Map<string, Promise<T>>();

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const promise = fn().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, promise);
    return promise;
  }
}

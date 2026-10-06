import { Injectable, Logger } from '@nestjs/common';
import { AsyncTaskPublisher } from '@/shared/messaging';
import { SourceCodeEnum } from '@/modules/source';
import { SourceTaskTypes } from '@/modules/substance/substancesourcedata/messaging/SourceTaskTypes';

export interface SourceFetchPayload {
  cas: string;
  source: SourceCodeEnum;
  refresh: boolean;
}

/** No se vuelve a encargar la misma fuente+CAS mientras el encargo anterior está "fresco". */
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Encarga al worker las fuentes lentas (modo `background`). Evita encargos duplicados: si diez
 * consultas piden el mismo CAS mientras OSHA aún no respondió, se publica UNA sola tarea.
 * (Además el handler revisa el cache antes de llamar a la fuente, así que un duplicado es barato.)
 */
@Injectable()
export class SourceFetchScheduler {
  private readonly logger = new Logger(SourceFetchScheduler.name);
  private readonly scheduledAt = new Map<string, number>();

  constructor(private readonly publisher: AsyncTaskPublisher) {}

  /** `true` si se publicó la tarea; `false` si ya estaba encargada. */
  async schedule(payload: SourceFetchPayload): Promise<boolean> {
    const key = `${payload.source}:${payload.cas}`;
    const now = Date.now();
    if (!payload.refresh && now - (this.scheduledAt.get(key) ?? 0) < DEDUP_WINDOW_MS) return false;

    this.scheduledAt.set(key, now);
    this.cleanup(now);
    try {
      await this.publisher.publish(SourceTaskTypes.SOURCE_FETCH, payload);
      return true;
    } catch (error) {
      this.scheduledAt.delete(key);
      this.logger.warn(`No se pudo encargar ${key} al worker: ${String(error)}`);
      return false;
    }
  }

  private cleanup(now: number): void {
    if (this.scheduledAt.size < 5_000) return;
    for (const [key, at] of this.scheduledAt) if (now - at > DEDUP_WINDOW_MS) this.scheduledAt.delete(key);
  }
}

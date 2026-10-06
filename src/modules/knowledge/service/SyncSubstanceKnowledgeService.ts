import { Injectable } from '@nestjs/common';
import { BaseService } from '@/shared/base';
import { mapWithConcurrency, Result } from '@/shared/util';
import { CollectSubstanceDataService } from '@/modules/substance';
import {
  IndexSubstanceKnowledgeResult,
  IndexSubstanceKnowledgeService,
} from '@/modules/knowledge/service/IndexSubstanceKnowledgeService';

export interface SyncSubstanceKnowledgeInput {
  /** Un CAS suelto o los componentes de una mezcla (se deduplican). */
  casList: string[];
  /**
   * `false` (por defecto): base local primero; solo se consulta una fuente si no hay dato o venció.
   * `true`: se consultan TODAS las fuentes aunque haya cache (lo usará el cron diario para detectar cambios).
   */
  refresh?: boolean;
  /** Consultar también las fuentes lentas en el momento (solo en el worker / cron). */
  runBackgroundSources?: boolean;
}

export interface SyncedSubstance {
  cas: string;
  /** Fuentes por estado: { OK: 6, NOT_FOUND: 2 }. */
  sources: Record<string, number>;
  /** Fuentes cuyo contenido cambió en esta sincronización (nueva versión guardada). */
  changedSources: string[];
  knowledge: IndexSubstanceKnowledgeResult | null;
  errors: string[];
}

const CONCURRENCY = 3;

/**
 * Deja al día los datos y la base de conocimiento (RAG) de uno o varios CAS. Es EL punto de entrada
 * reutilizable para "tener la información de estas sustancias":
 *  - la generación de una FDS (lo que pide el usuario),
 *  - el endpoint POST /knowledge/sync,
 *  - el cron que recorrerá los productos y sus componentes (`refresh: true`).
 *
 * Por cada CAS:
 *  1. Datos de las fuentes con cache-aside: si en la BD hay dato vigente, no se llama a la fuente.
 *     Si se consulta y el contenido cambió → nueva versión (la anterior va al historial); si es igual,
 *     solo se renueva el vencimiento.
 *  2. RAG: fragmenta y vectoriza SOLO lo nuevo o cambiado (idempotente y barato si nada cambió).
 */
@Injectable()
export class SyncSubstanceKnowledgeService extends BaseService<SyncSubstanceKnowledgeInput, SyncedSubstance[]> {
  constructor(
    private readonly collect: CollectSubstanceDataService,
    private readonly index: IndexSubstanceKnowledgeService,
  ) {
    super();
  }

  async execute({
    casList,
    refresh = false,
    runBackgroundSources = false,
  }: SyncSubstanceKnowledgeInput): Promise<Result<SyncedSubstance[]>> {
    try {
      const unique = [...new Set(casList)];
      const synced = await mapWithConcurrency(unique, CONCURRENCY, (cas) =>
        this.syncOne(cas, refresh, runBackgroundSources),
      );
      const changed = synced.reduce((sum, s) => sum + s.changedSources.length, 0);
      return Result.success(synced, `${unique.length} sustancia(s) sincronizada(s); ${changed} fuente(s) con cambios`);
    } catch (error) {
      return this.handleException('SyncSubstanceKnowledge', error);
    }
  }

  private async syncOne(cas: string, refresh: boolean, runBackgroundSources: boolean): Promise<SyncedSubstance> {
    const errors: string[] = [];
    const collected = await this.collect.execute({ cas, refresh, runBackgroundSources });
    if (!collected.isSuccess) errors.push(collected.message);
    const sources = collected.data?.sources ?? [];

    const indexed = await this.index.execute({ cas });
    if (!indexed.isSuccess) errors.push(indexed.message);

    return {
      cas,
      sources: sources.reduce<Record<string, number>>(
        (acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }),
        {},
      ),
      changedSources: sources.filter((s) => s.changed).map((s) => s.source),
      knowledge: indexed.data ?? null,
      errors,
    };
  }
}

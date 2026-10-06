import { Injectable } from '@nestjs/common';
import { Prisma, SourceStatus, SubstanceSourceData } from '@prisma/client';
import { PrismaService } from '@/shared/persistence';
import { contentHash } from '@/shared/util';

export type SubstanceSourceDataWithUrl = SubstanceSourceData & { rawSnapshot: { url: string } | null };

export interface SaveSubstanceSourceData {
  cas: string;
  source: string;
  status: SourceStatus;
  records: unknown[];
  contentHash: string;
  error?: string;
  durationMs?: number;
  retrievedAt: Date;
  expiresAt: Date;
  rawSnapshotId?: string;
}

export interface SaveResult {
  /** true si el contenido es nuevo o cambió (hay versión nueva). */
  changed: boolean;
  version: number;
}

/**
 * Los registros vienen de parsers de fuentes externas: un `undefined` dentro de un array (dato faltante)
 * hace fallar a Prisma. Ida y vuelta por JSON = exactamente lo que se guardaría (undefined → se quita /
 * null en arrays).
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? [])) as Prisma.InputJsonValue;
}

/**
 * Dato VIGENTE por (cas, fuente) + historial de versiones anteriores.
 * Siempre hay UNA sola versión válida; las anteriores quedan en `substance_source_data_history`
 * con su rango de validez (`valid_from` → `valid_to`).
 */
@Injectable()
export class SubstanceSourceDataRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Incluye la URL del snapshot crudo: es la página de la sustancia en la fuente. */
  findByCas(cas: string): Promise<SubstanceSourceDataWithUrl[]> {
    return this.prisma.substanceSourceData.findMany({
      where: { cas },
      include: { rawSnapshot: { select: { url: true } } },
    });
  }

  /** Hash del contenido actual (las filas viejas, de antes del versionado, no lo tienen guardado). */
  static hashOf(row: Pick<SubstanceSourceData, 'contentHash' | 'records'>): string {
    return row.contentHash ?? contentHash(row.records);
  }

  /**
   * Guarda una consulta nueva, en una transacción:
   *  - Sin dato previo → versión 1.
   *  - Mismo contenido y estado → solo se renuevan retrievedAt / expiresAt (no hay versión nueva).
   *  - Contenido distinto → el vigente pasa al historial y se escribe la versión siguiente.
   */
  saveVersioned(data: SaveSubstanceSourceData): Promise<SaveResult> {
    return this.prisma.$transaction(async (tx) => {
      const where = { cas_source: { cas: data.cas, source: data.source } };
      const current = await tx.substanceSourceData.findUnique({ where });
      const now = new Date();

      if (!current) {
        await tx.substanceSourceData.create({
          data: {
            cas: data.cas,
            source: data.source,
            status: data.status,
            records: toJson(data.records),
            contentHash: data.contentHash,
            version: 1,
            error: data.error ?? null,
            durationMs: data.durationMs ?? null,
            retrievedAt: data.retrievedAt,
            validFrom: now,
            expiresAt: data.expiresAt,
            rawSnapshotId: data.rawSnapshotId ?? null,
          },
        });
        return { changed: true, version: 1 };
      }

      const unchanged =
        SubstanceSourceDataRepository.hashOf(current) === data.contentHash && current.status === data.status;
      if (unchanged) {
        await tx.substanceSourceData.update({
          where,
          data: {
            contentHash: data.contentHash,
            retrievedAt: data.retrievedAt,
            expiresAt: data.expiresAt,
            durationMs: data.durationMs ?? null,
            error: null,
          },
        });
        return { changed: false, version: current.version };
      }

      await tx.substanceSourceDataHistory.create({
        data: {
          cas: current.cas,
          source: current.source,
          version: current.version,
          status: current.status,
          records: current.records as Prisma.InputJsonValue,
          contentHash: SubstanceSourceDataRepository.hashOf(current),
          validFrom: current.validFrom,
          validTo: now,
          rawSnapshotId: current.rawSnapshotId,
        },
      });
      const version = current.version + 1;
      await tx.substanceSourceData.update({
        where,
        data: {
          status: data.status,
          records: toJson(data.records),
          contentHash: data.contentHash,
          version,
          error: data.error ?? null,
          durationMs: data.durationMs ?? null,
          retrievedAt: data.retrievedAt,
          validFrom: now,
          expiresAt: data.expiresAt,
          rawSnapshotId: data.rawSnapshotId ?? current.rawSnapshotId,
        },
      });
      return { changed: true, version };
    });
  }
}

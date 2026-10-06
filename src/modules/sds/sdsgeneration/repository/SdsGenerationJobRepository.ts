import { Injectable } from '@nestjs/common';
import { Prisma, SdsGenerationJob, SdsGenerationStatus } from '@prisma/client';
import { PrismaService } from '@/shared/persistence';

@Injectable()
export class SdsGenerationJobRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: {
    tenantId: string;
    mixtureKey: string;
    request: unknown;
    requestedBy?: string;
  }): Promise<SdsGenerationJob> {
    return this.prisma.sdsGenerationJob.create({
      data: {
        tenantId: data.tenantId,
        mixtureKey: data.mixtureKey,
        request: data.request as Prisma.InputJsonValue,
        requestedBy: data.requestedBy ?? null,
      },
    });
  }

  findById(id: string): Promise<SdsGenerationJob | null> {
    return this.prisma.sdsGenerationJob.findUnique({ where: { id } });
  }

  /** Toma el job SOLO si sigue en cola: si el mensaje llega dos veces, el segundo no hace nada. */
  async claim(id: string): Promise<SdsGenerationJob | null> {
    const { count } = await this.prisma.sdsGenerationJob.updateMany({
      where: { id, status: SdsGenerationStatus.QUEUED },
      data: { status: SdsGenerationStatus.EXTRACTING, startedAt: new Date() },
    });
    return count ? this.findById(id) : null;
  }

  async progress(id: string, status: SdsGenerationStatus, progress: Record<string, unknown>): Promise<void> {
    await this.prisma.sdsGenerationJob.update({
      where: { id },
      data: { status, progress: progress as Prisma.InputJsonValue },
    });
  }

  async complete(
    id: string,
    documentId: string,
    status: SdsGenerationStatus,
    progress: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.sdsGenerationJob.update({
      where: { id },
      data: { status, documentId, finishedAt: new Date(), progress: progress as Prisma.InputJsonValue },
    });
  }

  async fail(id: string, error: string): Promise<void> {
    await this.prisma.sdsGenerationJob.update({
      where: { id },
      data: { status: SdsGenerationStatus.FAILED, error: error.slice(0, 2000), finishedAt: new Date() },
    });
  }

  /**
   * Marca como FAILED un job que sigue "en curso" desde antes de `startedBefore` (el worker murió o se
   * reinició a mitad de la generación). Devuelve true si lo marcó.
   */
  async failIfStale(id: string, startedBefore: Date, error: string): Promise<boolean> {
    const { count } = await this.prisma.sdsGenerationJob.updateMany({
      where: {
        id,
        status: { in: [SdsGenerationStatus.EXTRACTING, SdsGenerationStatus.CLASSIFYING, SdsGenerationStatus.DRAFTING] },
        startedAt: { lt: startedBefore },
      },
      data: { status: SdsGenerationStatus.FAILED, error, finishedAt: new Date() },
    });
    return count > 0;
  }
}

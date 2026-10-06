import { Injectable } from '@nestjs/common';
import { Prisma, SdsDocument } from '@prisma/client';
import { PrismaService } from '@/shared/persistence';

export interface CreateSdsDocument {
  tenantId: string;
  productId?: string;
  mixtureKey: string;
  countryCode?: string;
  language: string;
  content: unknown;
  provenance: unknown;
  missingData: unknown;
  llmModel: string;
  promptVersion: string;
  createdBy?: string;
}

@Injectable()
export class SdsDocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateSdsDocument): Promise<SdsDocument> {
    return this.prisma.sdsDocument.create({
      data: {
        tenantId: data.tenantId,
        productId: data.productId ?? null,
        mixtureKey: data.mixtureKey,
        countryCode: data.countryCode ?? null,
        language: data.language,
        content: data.content as Prisma.InputJsonValue,
        provenance: data.provenance as Prisma.InputJsonValue,
        missingData: data.missingData as Prisma.InputJsonValue,
        // Todavía no hay motor de clasificación SGA de mezclas (Fase 3).
        rulesVersion: 'no-classification-engine',
        llmModel: data.llmModel,
        promptVersion: data.promptVersion,
        createdBy: data.createdBy ?? null,
      },
    });
  }

  findById(id: string, tenantId: string): Promise<SdsDocument | null> {
    return this.prisma.sdsDocument.findFirst({ where: { id, tenantId } });
  }

  findRecent(tenantId: string, limit: number): Promise<SdsDocument[]> {
    return this.prisma.sdsDocument.findMany({ where: { tenantId }, orderBy: { updatedAt: 'desc' }, take: limit });
  }

  /** Guarda el contenido editado. `updatedAt` esperado: si otro lo cambió entre tanto, no pisa (devuelve false). */
  async updateContent(id: string, tenantId: string, expectedUpdatedAt: Date, content: unknown): Promise<boolean> {
    const { count } = await this.prisma.sdsDocument.updateMany({
      where: { id, tenantId, updatedAt: expectedUpdatedAt },
      data: { content: content as Prisma.InputJsonValue },
    });
    return count === 1;
  }
}

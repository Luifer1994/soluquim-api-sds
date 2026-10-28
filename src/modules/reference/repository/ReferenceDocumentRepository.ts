import { Injectable } from '@nestjs/common';
import { Prisma, ReferenceDocument, ReferenceDocumentScope, ReferenceDocumentStatus } from '@prisma/client';
import { PrismaService } from '@/shared/persistence';

export type ReferenceDocumentCreateData = Omit<
  Prisma.ReferenceDocumentUncheckedCreateInput,
  'id' | 'status' | 'file' | 'chunks' | 'createdAt' | 'updatedAt'
>;

/** Documentos de referencia y su archivo original (en tabla aparte: listar no carga los binarios). */
@Injectable()
export class ReferenceDocumentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea el documento y guarda su archivo en una sola transacción. */
  create(data: ReferenceDocumentCreateData, content: Buffer): Promise<ReferenceDocument> {
    return this.prisma.referenceDocument.create({
      data: { ...data, file: { create: { content: new Uint8Array(content) } } },
    });
  }

  /** Sin filtro de empresa: solo para el worker, que ya recibió el id de un documento válido. */
  findById(id: string): Promise<ReferenceDocument | null> {
    return this.prisma.referenceDocument.findUnique({ where: { id } });
  }

  /** El documento si esa empresa lo puede ver: la biblioteca es de todos; un documento del producto, de su empresa. */
  findAccessible(id: string, tenantId: string): Promise<ReferenceDocument | null> {
    return this.prisma.referenceDocument.findFirst({
      where: { id, ...ReferenceDocumentRepository.visibleTo(tenantId) },
    });
  }

  /** El mismo archivo ya subido en ese alcance (y, en un documento del producto, de esa empresa y componente). */
  findDuplicate(
    contentHash: string,
    scope: ReferenceDocumentScope,
    product: { tenantId: string; cas: string | null } | null,
  ): Promise<ReferenceDocument | null> {
    return this.prisma.referenceDocument.findFirst({ where: { contentHash, scope, ...(product ?? {}) } });
  }

  findAll(filter: { scope: ReferenceDocumentScope; tenantId: string; ids?: string[] }): Promise<ReferenceDocument[]> {
    return this.prisma.referenceDocument.findMany({
      where: {
        scope: filter.scope,
        ...ReferenceDocumentRepository.visibleTo(filter.tenantId),
        ...(filter.ids ? { id: { in: filter.ids } } : {}),
      },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });
  }

  /** Documentos del producto de esa empresa entre los ids pedidos. */
  findProductDocuments(ids: readonly string[], tenantId: string): Promise<ReferenceDocument[]> {
    return ids.length
      ? this.prisma.referenceDocument.findMany({
          where: { id: { in: [...ids] }, scope: ReferenceDocumentScope.PRODUCT, tenantId },
        })
      : Promise.resolve([]);
  }

  async findFile(id: string): Promise<Buffer | null> {
    const file = await this.prisma.referenceDocumentFile.findUnique({ where: { documentId: id } });
    return file ? Buffer.from(file.content) : null;
  }

  update(id: string, data: Prisma.ReferenceDocumentUpdateInput): Promise<ReferenceDocument> {
    return this.prisma.referenceDocument.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    // Archivo y fragmentos se borran en cascada.
    await this.prisma.referenceDocument.delete({ where: { id } });
  }

  /** Vuelve a la cola: el worker lo indexa de nuevo desde su archivo. */
  requeue(id: string): Promise<ReferenceDocument> {
    return this.prisma.referenceDocument.update({
      where: { id },
      data: { status: ReferenceDocumentStatus.PENDING, error: null },
    });
  }

  /** Toma el documento SOLO si está en cola: si el mensaje llega dos veces, el segundo no hace nada. */
  async claim(id: string): Promise<ReferenceDocument | null> {
    const { count } = await this.prisma.referenceDocument.updateMany({
      where: { id, status: ReferenceDocumentStatus.PENDING },
      data: { status: ReferenceDocumentStatus.PROCESSING, error: null, chunkCount: 0, embeddedCount: 0 },
    });
    return count ? this.findById(id) : null;
  }

  async progress(
    id: string,
    data: { pageCount?: number | null; chunkCount?: number; embeddedCount?: number },
  ): Promise<void> {
    await this.prisma.referenceDocument.update({ where: { id }, data });
  }

  async ready(id: string, embeddedCount: number): Promise<void> {
    await this.prisma.referenceDocument.update({
      where: { id },
      data: { status: ReferenceDocumentStatus.READY, embeddedCount, indexedAt: new Date(), error: null },
    });
  }

  async fail(id: string, error: string): Promise<void> {
    await this.prisma.referenceDocument.update({
      where: { id },
      data: { status: ReferenceDocumentStatus.FAILED, error: error.slice(0, 2000) },
    });
  }

  /** Lo que ve una empresa: la biblioteca (de toda la plataforma) y sus propios documentos del producto. */
  private static visibleTo(tenantId: string): Prisma.ReferenceDocumentWhereInput {
    return { OR: [{ scope: ReferenceDocumentScope.LIBRARY }, { tenantId }] };
  }
}

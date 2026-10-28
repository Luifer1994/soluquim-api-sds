import { ReferenceDocument } from '@prisma/client';
import { ReferenceDocumentResponseDTO } from '@/modules/reference/dto/response';

export class ReferenceDocumentMapper {
  static toResponse(document: ReferenceDocument): ReferenceDocumentResponseDTO {
    return {
      id: document.id,
      title: document.title,
      description: document.description,
      category: document.category,
      scope: document.scope,
      cas: document.cas,
      language: document.language,
      sdsSections: document.sdsSections,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      status: document.status,
      pageCount: document.pageCount,
      chunkCount: document.chunkCount,
      embeddedCount: document.embeddedCount,
      error: document.error,
      indexedAt: document.indexedAt?.toISOString() ?? null,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  /** "GRE 2024 · p. 155–156": cómo se cita un fragmento en la FDS. */
  static citationTitle(documentTitle: string, pageFrom: number | null, pageTo: number | null): string {
    if (pageFrom === null) return documentTitle;
    return pageTo !== null && pageTo !== pageFrom
      ? `${documentTitle} · p. ${pageFrom}–${pageTo}`
      : `${documentTitle} · p. ${pageFrom}`;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { AiStatus, EMBEDDING_PROVIDER, EmbeddingProvider } from '@/shared/ai';
import { BaseService } from '@/shared/base';
import { Result } from '@/shared/util';
import { ReferenceDocumentChunker } from '@/modules/reference/chunker';
import { DocumentTextExtractorRegistry } from '@/modules/reference/extractor';
import { ReferenceChunkRepository, ReferenceDocumentRepository } from '@/modules/reference/repository';

export interface IndexReferenceDocumentResult {
  documentId: string;
  pageCount: number | null;
  chunks: number;
  embedded: number;
}

const EMBED_BATCH = 64;

/**
 * Worker: deja un documento de referencia listo para el agente.
 *  1. toma el documento si está en cola (idempotente ante mensajes repetidos),
 *  2. extrae el texto con el extractor de su formato,
 *  3. lo parte en fragmentos con sus páginas (ReferenceDocumentChunker) y los guarda,
 *  4. vectoriza en lotes, actualizando el avance (lo ve la pantalla).
 * Sin clave de IA queda READY sin vectores: el agente lo encuentra solo por identificadores (CAS, número
 * ONU) hasta que se reindexe con la IA activa.
 */
@Injectable()
export class IndexReferenceDocumentService extends BaseService<
  { documentId: string },
  IndexReferenceDocumentResult | null
> {
  constructor(
    private readonly documents: ReferenceDocumentRepository,
    private readonly chunks: ReferenceChunkRepository,
    private readonly extractors: DocumentTextExtractorRegistry,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly ai: AiStatus,
  ) {
    super();
  }

  async execute({ documentId }: { documentId: string }): Promise<Result<IndexReferenceDocumentResult | null>> {
    const document = await this.documents.claim(documentId);
    if (!document) return Result.success(null, 'El documento ya se estaba indexando o no está en cola');

    const startedAt = Date.now();
    try {
      const extractor = this.extractors.forFile(document.fileName);
      if (!extractor) throw new Error(`Formato no soportado: ${document.fileName}`);
      const file = await this.documents.findFile(documentId);
      if (!file) throw new Error('El documento no tiene archivo');

      const extracted = await extractor.extract(file);
      const drafts = ReferenceDocumentChunker.chunk(extracted.pages);
      if (!drafts.length) {
        throw new Error('No se encontró texto en el documento (¿es un PDF escaneado sin texto?)');
      }
      await this.chunks.replace(documentId, drafts);
      await this.documents.progress(documentId, { pageCount: extracted.pageCount, chunkCount: drafts.length });

      const embedded = this.ai.enabled ? await this.embedAll(documentId) : 0;
      await this.documents.ready(documentId, embedded);
      this.logger.log(
        `Documento de referencia "${document.title}": ${extracted.pageCount ?? '-'} páginas, ${drafts.length} ` +
          `fragmentos, ${embedded} vectorizados (${Date.now() - startedAt} ms)`,
      );
      return Result.success({ documentId, pageCount: extracted.pageCount, chunks: drafts.length, embedded });
    } catch (error) {
      await this.documents.fail(documentId, error instanceof Error ? error.message : String(error));
      return this.handleException('IndexReferenceDocument', error);
    }
  }

  private async embedAll(documentId: string): Promise<number> {
    let embedded = 0;
    for (;;) {
      const pending = await this.chunks.findPendingEmbedding(documentId, EMBED_BATCH);
      if (!pending.length) break;
      const vectors = await this.embeddings.embed(pending.map((chunk) => chunk.content));
      await this.chunks.setEmbeddings(
        pending.map((chunk, index) => ({ id: chunk.id, embedding: vectors[index] })),
        this.embeddings.model,
      );
      embedded += pending.length;
      await this.documents.progress(documentId, { embeddedCount: embedded });
      if (pending.length < EMBED_BATCH) break;
    }
    return this.chunks.countEmbedded(documentId);
  }
}

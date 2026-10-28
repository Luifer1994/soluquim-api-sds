import { Injectable } from '@nestjs/common';
import { ReferenceDocument, ReferenceDocumentStatus } from '@prisma/client';
import { BaseService } from '@/shared/base';
import { mapWithConcurrency, Result } from '@/shared/util';
import { ReferenceDocumentRepository } from '@/modules/reference/repository';
import { IndexReferenceDocumentService } from '@/modules/reference/service/IndexReferenceDocumentService';

/** Documento del producto listo para el agente. */
export interface ProductDocument {
  id: string;
  title: string;
  category: ReferenceDocument['category'];
  /** CAS del componente que describe (null = el producto o un análogo). */
  cas: string | null;
}

export interface PrepareProductDocumentsInput {
  documentIds: string[];
  /** Empresa del job: solo se usan sus documentos del producto. */
  tenantId: string;
}

export interface PrepareProductDocumentsResult {
  documents: ProductDocument[];
  /** Los que no se pudieron usar y por qué (quedan en los errores de la generación). */
  skipped: string[];
}

/** Cómo terminó cada documento pedido: listo para el agente u omitido con su motivo. */
type PreparedOutcome = { document?: ProductDocument; skipped?: string };

/** Cuánto espera la generación a un documento que el worker está indexando. */
const WAIT_MS = 180_000;
const POLL_MS = 2_000;
/** Documentos que se preparan a la vez (cada uno puede vectorizarse en el momento). */
const CONCURRENCY = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Worker (al generar): deja listos los documentos del producto adjuntos a la generación. Si alguno sigue
 * en cola lo indexa en el momento (no espera su turno en la cola); si otro proceso lo está indexando,
 * espera a que termine. Los que no existen, no son del producto o fallaron se omiten y se informan.
 */
@Injectable()
export class PrepareProductDocumentsService extends BaseService<
  PrepareProductDocumentsInput,
  PrepareProductDocumentsResult
> {
  constructor(
    private readonly documents: ReferenceDocumentRepository,
    private readonly index: IndexReferenceDocumentService,
  ) {
    super();
  }

  async execute({
    documentIds,
    tenantId,
  }: PrepareProductDocumentsInput): Promise<Result<PrepareProductDocumentsResult>> {
    try {
      const found = new Map((await this.documents.findProductDocuments(documentIds, tenantId)).map((d) => [d.id, d]));
      // En paralelo (con tope) y en el orden pedido.
      const outcomes = await mapWithConcurrency(documentIds, CONCURRENCY, async (id): Promise<PreparedOutcome> => {
        const document = found.get(id);
        if (!document) return { skipped: `Documento ${id}: no existe o no es un documento del producto de la empresa` };
        const ready = await this.ensureReady(document);
        return ready?.status === ReferenceDocumentStatus.READY
          ? { document: { id: ready.id, title: ready.title, category: ready.category, cas: ready.cas } }
          : { skipped: `"${document.title}": no se pudo indexar${ready?.error ? ` (${ready.error})` : ''}` };
      });
      return Result.success({
        documents: outcomes.flatMap((outcome) => (outcome.document ? [outcome.document] : [])),
        skipped: outcomes.flatMap((outcome) => (outcome.skipped ? [outcome.skipped] : [])),
      });
    } catch (error) {
      return this.handleException('PrepareProductDocuments', error);
    }
  }

  private async ensureReady(document: ReferenceDocument): Promise<ReferenceDocument | null> {
    if (document.status === ReferenceDocumentStatus.PENDING) {
      await this.index.execute({ documentId: document.id });
    }
    const deadline = Date.now() + WAIT_MS;
    let current = await this.documents.findById(document.id);
    while (current?.status === ReferenceDocumentStatus.PROCESSING && Date.now() < deadline) {
      await sleep(POLL_MS);
      current = await this.documents.findById(document.id);
    }
    return current;
  }
}

import { Module } from '@nestjs/common';
import { ReferenceDocumentController } from '@/modules/reference/controller';
import {
  DOCUMENT_TEXT_EXTRACTORS,
  DocumentTextExtractor,
  DocumentTextExtractorRegistry,
  DocxTextExtractor,
  PdfTextExtractor,
} from '@/modules/reference/extractor';
import { ReferenceDocumentIndexHandler } from '@/modules/reference/messaging';
import { ReferenceChunkRepository, ReferenceDocumentRepository } from '@/modules/reference/repository';
import {
  BuildProductDocumentContextService,
  BuildReferenceContextService,
  DeleteReferenceDocumentService,
  DownloadReferenceDocumentService,
  GetReferenceDocumentOptionsService,
  IndexReferenceDocumentService,
  ListReferenceDocumentsService,
  PrepareProductDocumentsService,
  ReindexReferenceDocumentService,
  UpdateReferenceDocumentService,
  UploadReferenceDocumentService,
} from '@/modules/reference/service';

/**
 * Documentación de referencia y documentos del producto. La biblioteca (libros del SGA, GRE, Reglamentación
 * Modelo, Manual de Pruebas, procedimientos internos…) se sube una vez, se vectoriza y el agente la consulta
 * en CADA generación. Los documentos del producto (FDS de las materias primas y de análogos, datos del
 * producto final) solo entran en las generaciones que los adjuntan. Para aceptar un formato nuevo: un
 * extractor más en `DOCUMENT_TEXT_EXTRACTORS`.
 */
@Module({
  controllers: [ReferenceDocumentController],
  providers: [
    PdfTextExtractor,
    DocxTextExtractor,
    {
      provide: DOCUMENT_TEXT_EXTRACTORS,
      useFactory: (...extractors: DocumentTextExtractor[]) => extractors,
      inject: [PdfTextExtractor, DocxTextExtractor],
    },
    DocumentTextExtractorRegistry,
    ReferenceDocumentRepository,
    ReferenceChunkRepository,
    UploadReferenceDocumentService,
    ListReferenceDocumentsService,
    GetReferenceDocumentOptionsService,
    UpdateReferenceDocumentService,
    DeleteReferenceDocumentService,
    ReindexReferenceDocumentService,
    DownloadReferenceDocumentService,
    IndexReferenceDocumentService,
    BuildReferenceContextService,
    PrepareProductDocumentsService,
    BuildProductDocumentContextService,
    ReferenceDocumentIndexHandler,
  ],
  exports: [BuildReferenceContextService, PrepareProductDocumentsService, BuildProductDocumentContextService],
})
export class ReferenceModule {}

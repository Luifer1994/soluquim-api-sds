import { Inject, Injectable } from '@nestjs/common';
import { DOCUMENT_TEXT_EXTRACTORS, DocumentTextExtractor } from '@/modules/reference/extractor/DocumentTextExtractor';

/** Elige el extractor por la extensión del archivo. Lo que no tenga extractor no se puede subir. */
@Injectable()
export class DocumentTextExtractorRegistry {
  constructor(@Inject(DOCUMENT_TEXT_EXTRACTORS) private readonly extractors: DocumentTextExtractor[]) {
    const seen = new Set<string>();
    for (const extension of extractors.flatMap((extractor) => extractor.extensions)) {
      if (seen.has(extension)) throw new Error(`Dos extractores de texto aceptan ".${extension}"`);
      seen.add(extension);
    }
  }

  forFile(fileName: string): DocumentTextExtractor | undefined {
    const extension = DocumentTextExtractorRegistry.extensionOf(fileName);
    return this.extractors.find((extractor) => extractor.extensions.includes(extension));
  }

  /** Extensiones aceptadas (para validar la subida y para el mensaje de error). */
  supportedExtensions(): string[] {
    return this.extractors.flatMap((extractor) => [...extractor.extensions]);
  }

  static extensionOf(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
  }
}

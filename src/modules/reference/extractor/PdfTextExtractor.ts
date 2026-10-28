import { Injectable } from '@nestjs/common';
import { getDocumentProxy } from 'unpdf';
import {
  DocumentTextExtractor,
  ExtractedDocument,
  ExtractedPage,
} from '@/modules/reference/extractor/DocumentTextExtractor';

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

/**
 * PDF (pdf.js vía unpdf). Lee página por página y libera cada una al terminar: un libro de cientos de
 * páginas (SGA, GRE, Reglamentación Modelo) no se carga entero en memoria como texto intermedio.
 * Un PDF escaneado (solo imágenes) da páginas vacías: el documento queda indexado sin fragmentos.
 */
@Injectable()
export class PdfTextExtractor implements DocumentTextExtractor {
  readonly format = 'PDF';
  readonly extensions = ['pdf'] as const;

  async extract(content: Buffer): Promise<ExtractedDocument> {
    const pdf = await getDocumentProxy(new Uint8Array(content));
    try {
      const pages: ExtractedPage[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const { items } = await page.getTextContent();
        const text = (items as PdfTextItem[]).map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`).join('');
        pages.push({ number, text });
        page.cleanup();
      }
      return { pages, pageCount: pdf.numPages };
    } finally {
      await pdf.loadingTask.destroy();
    }
  }
}

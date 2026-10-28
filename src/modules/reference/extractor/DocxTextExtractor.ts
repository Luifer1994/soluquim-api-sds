import { Injectable } from '@nestjs/common';
import mammoth from 'mammoth';
import { DocumentTextExtractor, ExtractedDocument } from '@/modules/reference/extractor/DocumentTextExtractor';

/** Word (.docx, vía mammoth): el texto completo, un párrafo por línea. Word no tiene páginas fijas. */
@Injectable()
export class DocxTextExtractor implements DocumentTextExtractor {
  readonly format = 'Word';
  readonly extensions = ['docx'] as const;

  async extract(content: Buffer): Promise<ExtractedDocument> {
    const { value } = await mammoth.extractRawText({ buffer: content });
    return { pages: [{ number: null, text: value }], pageCount: null };
  }
}

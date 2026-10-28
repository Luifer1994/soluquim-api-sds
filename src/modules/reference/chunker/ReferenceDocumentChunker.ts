import { ExtractedPage } from '@/modules/reference/extractor';

export interface ReferenceChunkDraft {
  position: number;
  pageFrom: number | null;
  pageTo: number | null;
  content: string;
  /** Secciones de FDS del fragmento (si el documento es una FDS); vacío si no se detectaron. */
  sdsSections: number[];
}

export interface ChunkerOptions {
  /** Tamaño objetivo de un fragmento (caracteres). */
  targetChars?: number;
  /** Caracteres del final de un fragmento que se repiten al inicio del siguiente (contexto entre cortes). */
  overlapChars?: number;
}

interface Line {
  text: string;
  page: number | null;
  /** Sección de FDS en la que está la línea (null = ninguna detectada todavía). */
  section: number | null;
}

const TARGET_CHARS = 1400;
const OVERLAP_CHARS = 200;
/** Un fragmento con menos texto útil que esto (índices, páginas en blanco) no se guarda. */
const MIN_USEFUL_CHARS = 60;
/** Una línea que se repite en esta proporción de páginas es encabezado o pie de página. */
const REPEATED_LINE_RATIO = 0.4;
/** Líneas del inicio y del final de cada página donde se buscan encabezados y pies. */
const HEADER_LINES = 8;
const FOOTER_LINES = 4;
/** Con menos páginas no se buscan encabezados: no hay forma confiable de distinguirlos. */
const MIN_PAGES_FOR_HEADERS = 4;
/** "SECCIÓN 5", "SECCION 5.", "Section 5:", "EPÍGRAFE 5" (cualquier sección). */
const SECTION_HEADING = /^(?:SECCI[ÓO]N|SECTION|EP[ÍI]GRAFE)\s*:?\s*(\d{1,2})\b/iu;
/** "5 Medidas en caso de incendio", "5. Medidas…" (solo si es la sección siguiente: evita falsos positivos). */
const NUMBERED_HEADING = /^(\d{1,2})\s*[.)]?\s+\p{Lu}\p{L}{2,}/u;
/** "5.1 Medios de extinción" (subsección: confirma o avanza a la sección siguiente). */
const SUBSECTION_HEADING = /^(\d{1,2})\.\d{1,2}\.?\s+\p{L}/u;
const SDS_SECTIONS = 16;

/**
 * Parte un documento en fragmentos para el RAG (función pura):
 *  1. quita encabezados y pies de página (líneas que se repiten en muchas páginas, como "Página 3 de 33"
 *     o el cuadro de control del documento), que solo meten ruido en la búsqueda,
 *  2. une palabras cortadas con guion al final de línea y normaliza espacios,
 *  3. junta líneas hasta ~1400 caracteres sin cortar una línea a la mitad (salvo las muy largas) y repite
 *     el final de cada fragmento al inicio del siguiente, para no perder el contexto en los cortes,
 *  4. guarda de qué páginas sale cada fragmento (para citarlo: "GRE 2024 · p. 155–156"),
 *  5. si el documento es una FDS (la de un proveedor, la de un producto análogo), detecta en qué sección
 *     está cada línea ("SECCIÓN 5…", "5 Medidas en caso de incendio") y corta en cada cambio de sección:
 *     al redactar la sección 5 se le da al agente justo la sección 5 de esa FDS.
 */
export class ReferenceDocumentChunker {
  static chunk(pages: readonly ExtractedPage[], options: ChunkerOptions = {}): ReferenceChunkDraft[] {
    const target = options.targetChars ?? TARGET_CHARS;
    const overlap = options.overlapChars ?? OVERLAP_CHARS;
    const lines = ReferenceDocumentChunker.lines(pages, target);

    const chunks: ReferenceChunkDraft[] = [];
    let current: Line[] = [];
    let size = 0;
    /** Líneas nuevas desde el último corte (sin contar el traslape): sin ellas no hay fragmento nuevo. */
    let fresh = 0;
    const flush = (carryOver = true) => {
      const content = current
        .map((line) => line.text)
        .join('\n')
        .trim();
      if (content.replace(/[^\p{L}]+/gu, '').length >= MIN_USEFUL_CHARS) {
        const numbered = current.map((line) => line.page).filter((page): page is number => page !== null);
        chunks.push({
          position: chunks.length,
          pageFrom: numbered.length ? Math.min(...numbered) : null,
          pageTo: numbered.length ? Math.max(...numbered) : null,
          content,
          sdsSections: [...new Set(current.map((line) => line.section).filter((n): n is number => n !== null))].sort(
            (a, b) => a - b,
          ),
        });
      }
      // Traslape: las últimas líneas (hasta `overlap` caracteres) arrancan el siguiente fragmento.
      const carried: Line[] = [];
      let carriedSize = 0;
      for (let index = current.length - 1; carryOver && index > 0 && carriedSize < overlap; index--) {
        carried.unshift(current[index]);
        carriedSize += current[index].text.length + 1;
      }
      current = carried;
      size = carriedSize;
      fresh = 0;
    };

    for (const line of lines) {
      // Nueva sección de FDS: corte limpio, sin arrastrar el final de la sección anterior.
      const sectionChanged = line.section !== null && current.length > 0 && current.at(-1)!.section !== line.section;
      if (fresh > 0 && sectionChanged) flush(false);
      else if (fresh > 0 && size + line.text.length > target) flush();
      current.push(line);
      size += line.text.length + 1;
      fresh++;
    }
    if (fresh > 0) flush();
    return chunks;
  }

  /** Líneas limpias de todas las páginas, sin encabezados ni pies, con las muy largas ya partidas. */
  private static lines(pages: readonly ExtractedPage[], target: number): Line[] {
    const split = pages.map((page) => ({ page, lines: ReferenceDocumentChunker.pageLines(page) }));
    const repeated = ReferenceDocumentChunker.repeatedLines(split.map((entry) => entry.lines));
    let section: number | null = null;
    const withSections = (text: string): Line['section'] => {
      section = ReferenceDocumentChunker.sectionOf(text, section);
      return section;
    };
    return split.flatMap(({ page, lines }) =>
      lines
        .filter(
          (text, index) =>
            !(
              ReferenceDocumentChunker.isEdge(index, lines.length) &&
              repeated.has(ReferenceDocumentChunker.signature(text))
            ),
        )
        .flatMap((text) => ReferenceDocumentChunker.split(text, target))
        .map((text) => ({ text, page: page.number, section: withSections(text) })),
    );
  }

  /** La sección de FDS en la que queda el texto después de esta línea (función pura). */
  static sectionOf(text: string, current: number | null): number | null {
    const valid = (n: number) => n >= 1 && n <= SDS_SECTIONS;
    const explicit = SECTION_HEADING.exec(text);
    if (explicit && valid(Number(explicit[1]))) return Number(explicit[1]);
    const next = (current ?? 0) + 1;
    const numbered = NUMBERED_HEADING.exec(text) ?? SUBSECTION_HEADING.exec(text);
    if (numbered && Number(numbered[1]) === next && valid(next)) return next;
    return current;
  }

  private static pageLines(page: ExtractedPage): string[] {
    return ReferenceDocumentChunker.clean(page.text)
      .split('\n')
      .map((text) => text.trim())
      .filter(Boolean);
  }

  /** Encabezados y pies solo se buscan en las primeras y últimas líneas de la página, nunca en el cuerpo. */
  private static isEdge(index: number, total: number): boolean {
    // En páginas cortas el borde se achica: que el encabezado no se coma el cuerpo.
    const header = Math.min(HEADER_LINES, Math.ceil(total * 0.3));
    const footer = Math.min(FOOTER_LINES, Math.ceil(total * 0.15));
    return index < header || index >= total - footer;
  }

  /**
   * Une la palabra cortada al final de línea conservando el guion ("seguri-dad", "diana-exposición"): quitarlo
   * dañaría nombres químicos y compuestos que sí lo llevan. Colapsa espacios y líneas en blanco.
   */
  private static clean(text: string): string {
    return text
      .replace(/\r\n?/g, '\n')
      .replace(/(\p{L})-\n(\p{Ll})/gu, '$1-$2')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
  }

  /** Firma de una línea para detectar repetidas: sin números (cambia el número de página) ni mayúsculas. */
  private static signature(text: string): string {
    return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  }

  /** Firmas de las líneas de borde que se repiten en muchas páginas (encabezados y pies). */
  private static repeatedLines(pages: readonly string[][]): Set<string> {
    if (pages.length < MIN_PAGES_FOR_HEADERS) return new Set();
    const counts = new Map<string, number>();
    for (const lines of pages) {
      const signatures = new Set(
        lines
          .filter((_, index) => ReferenceDocumentChunker.isEdge(index, lines.length))
          .map((line) => ReferenceDocumentChunker.signature(line)),
      );
      signatures.forEach((signature) => counts.set(signature, (counts.get(signature) ?? 0) + 1));
    }
    const threshold = Math.max(3, Math.ceil(pages.length * REPEATED_LINE_RATIO));
    return new Set([...counts].filter(([, count]) => count >= threshold).map(([signature]) => signature));
  }

  /** Una línea más larga que el fragmento (Word: un párrafo entero) se parte por oraciones o, si no hay, a la fuerza. */
  private static split(text: string, target: number): string[] {
    if (text.length <= target) return [text];
    const parts: string[] = [];
    let rest = text;
    while (rest.length > target) {
      const window = rest.slice(0, target);
      const sentenceEnd = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '));
      const cut =
        sentenceEnd > target / 2
          ? sentenceEnd + 1
          : window.lastIndexOf(' ') > target / 2
            ? window.lastIndexOf(' ')
            : target;
      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }
}

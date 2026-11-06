import { KnowledgeSearchHit } from '@/modules/knowledge';
import { ProductDocument } from '@/modules/reference';

/** Un fragmento de un documento subido (referencia o del producto), listo para citarse como el conocimiento por CAS. */
export interface CitableFragment {
  id: string;
  citationTitle: string;
  content: string;
  similarity: number | null;
  language?: string;
  document?: ProductDocument;
}

/**
 * Referencias citables de un grupo de secciones (K…, D…, R… del contexto inicial y S…, R…, D… de las búsquedas de
 * los agentes). Es el mapa que usa la validación de citas: lo que un agente encuentra se registra aquí y su cita vale
 * igual que la del contexto inicial. Un fragmento que ya estaba conserva su referencia; uno nuevo continúa la
 * numeración de su tipo.
 */
export class CitableRefs {
  constructor(readonly map: Map<string, KnowledgeSearchHit> = new Map()) {}

  /** Un documento subido como fragmento citable (fuente: REFERENCE o PRODUCT_DOCUMENT). */
  static fromDocument(
    fragment: CitableFragment,
    source: string,
    sections: number[],
    language: string,
  ): KnowledgeSearchHit {
    return {
      id: fragment.id,
      cas: fragment.document?.cas ?? null,
      source,
      title: fragment.citationTitle,
      content: fragment.content,
      sdsSections: sections,
      sourceUrl: null,
      language: fragment.language ?? language,
      similarity: fragment.similarity,
    };
  }

  /** Referencia del fragmento (la que ya tenía o una nueva con ese prefijo). */
  register(prefix: 'S' | 'R' | 'D', hit: KnowledgeSearchHit): string {
    for (const [ref, known] of this.map) if (known.id === hit.id) return ref;
    const used = [...this.map.keys()]
      .filter((key) => new RegExp(`^${prefix}\\d+$`).test(key))
      .map((key) => Number(key.slice(1)));
    const ref = `${prefix}${Math.max(0, ...used) + 1}`;
    this.map.set(ref, hit);
    return ref;
  }
}

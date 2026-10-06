import { KnowledgeSearchHit } from '@/modules/knowledge';
import { SdsCitationDTO } from '@/modules/sds/sdsdocument/dto/response';

/**
 * Verifica las referencias del agente contra el contexto que REALMENTE se le dio (función pura):
 * las válidas se convierten en citas (fuente, CAS, URL); las inexistentes se devuelven aparte.
 */
export class ProvenanceValidator {
  static resolve(
    sourceRefs: readonly string[],
    refs: ReadonlyMap<string, KnowledgeSearchHit>,
  ): { citations: SdsCitationDTO[]; invalid: string[] } {
    const citations: SdsCitationDTO[] = [];
    const invalid: string[] = [];
    for (const ref of new Set(sourceRefs.map((r) => r.trim().toUpperCase()).filter(Boolean))) {
      const hit = refs.get(ref);
      if (hit) citations.push({ ref, source: hit.source, cas: hit.cas, title: hit.title, sourceUrl: hit.sourceUrl });
      else invalid.push(ref);
    }
    return { citations, invalid };
  }
}

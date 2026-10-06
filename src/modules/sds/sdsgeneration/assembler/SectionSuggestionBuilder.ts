import { KnowledgeSearchHit, SdsSectionDefinition } from '@/modules/knowledge';
import {
  SdsCitationDTO,
  SdsFieldDTO,
  SdsSectionSuggestionDTO,
  SdsSubsectionDTO,
} from '@/modules/sds/sdsdocument/dto/response';
import { SdsSectionContentMapper } from '@/modules/sds/sdsdocument/mapper';
import { SdsSectionDraft } from '@/modules/sds/sdsgeneration/agent';
import { ProvenanceValidator } from '@/modules/sds/sdsgeneration/validator';

/** Un valor tomado directamente de las fuentes, con las citas de donde salió. */
export interface SourcedValue {
  value: string | null;
  citations: SdsCitationDTO[];
}

/** Textos con los que un modelo "rellena" un campo vacío: se tratan como vacío. */
const FILLER =
  /^(null|sin (datos|informaci[oó]n)( disponibles?)?|no (disponible|aplica|aplicable|se especifica|especificado|determinado|hay datos|se dispone de (datos|informaci[oó]n))|n\/?a|ninguno\(?a?\)?|no data( available)?|not (available|applicable|specified))\.?$/i;
/** Referencias internas (K1, K2…) que el modelo deja dentro del texto: van en las citas, no en el valor. */
const INLINE_REFS = /\s*[[(]\s*K\d+(?:\s*,\s*K\d+)*\s*[\])]/g;

export interface DraftCleanup {
  /**
   * Nombres del producto cuando es UNA sustancia: el modelo a veces antepone "Tolueno: " a cada dato;
   * en una sustancia pura sobra (en una mezcla sí se conserva: atribuye el dato a su componente).
   */
  ownNames?: readonly string[];
}

function normalize(value: string | null | undefined, cleanup: DraftCleanup = {}): string | null {
  const names = (cleanup.ownNames ?? []).filter(Boolean).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const ownPrefix = names.length ? new RegExp(`^(?:${names.join('|')})\\s*(?:\\([^)]*\\))?\\s*:\\s*`, 'i') : null;
  const cleaned = (value ?? '')
    .replace(INLINE_REFS, '')
    .split('\n')
    .map((line) => (ownPrefix ? line.replace(ownPrefix, '') : line).trim())
    // "Agua: null" y similares: el modelo escribió la palabra en vez de omitir el dato.
    .filter((line) => line && !/:\s*null\.?$/i.test(line))
    .join('\n')
    .trim();
  return cleaned && !FILLER.test(cleaned) ? cleaned : null;
}

const CONFIDENCE_ORDER: Array<SdsSectionDraft['confidence']> = ['low', 'medium', 'high'];

export class SectionSuggestionBuilder {
  /**
   * Una sola entrada por sección. A veces el modelo reparte los campos de una sección en varias
   * entradas con el mismo número: se unen (el primer valor no vacío de cada campo gana, se juntan los
   * conflictos y queda la confianza más baja). Sin esto, la última entrada pisaría a las demás.
   */
  static mergeDrafts(drafts: readonly SdsSectionDraft[]): SdsSectionDraft[] {
    const merged = new Map<number, SdsSectionDraft>();
    for (const draft of drafts) {
      const known = merged.get(draft.number);
      if (!known) {
        merged.set(draft.number, { ...draft, fields: [...draft.fields], conflicts: [...draft.conflicts] });
        continue;
      }
      for (const field of draft.fields) {
        const index = known.fields.findIndex((f) => f.key === field.key);
        if (index === -1) known.fields.push(field);
        else if (!normalize(known.fields[index].value) && normalize(field.value)) known.fields[index] = field;
      }
      known.conflicts.push(...draft.conflicts);
      // La confianza de una entrada sin ningún dato no cuenta (suele venir en "low" por estar vacía).
      if (draft.fields.some((f) => normalize(f.value))) {
        const filled = known.fields.some((f) => normalize(f.value));
        known.confidence =
          filled && CONFIDENCE_ORDER.indexOf(draft.confidence) > CONFIDENCE_ORDER.indexOf(known.confidence)
            ? known.confidence
            : draft.confidence;
      }
    }
    return [...merged.values()];
  }

  /**
   * Desde la respuesta del agente. Por cada campo de la plantilla:
   *  - el modelo no lo devolvió, lo dejó en null o puso un texto de relleno → vacío,
   *  - tiene valor pero NINGUNA cita válida → se descarta (queda en `discarded` para el revisor),
   *  - tiene valor y cita → entra con sus citas.
   * Campos que el modelo invente fuera de la plantilla se ignoran.
   */
  static fromAgent(
    section: SdsSectionDefinition,
    draft: SdsSectionDraft,
    refs: ReadonlyMap<string, KnowledgeSearchHit>,
    language: string,
    cleanup: DraftCleanup = {},
  ): SdsSectionSuggestionDTO {
    const drafted = new Map(draft.fields.map((field) => [field.key, field]));
    const invalidRefs = new Set<string>();
    const discarded: SdsSectionSuggestionDTO['discarded'] = [];

    const subsections = section.subsections.map((sub) => ({
      code: sub.code,
      title: sub.title,
      fields: sub.fields.map((definition): SdsFieldDTO => {
        const base = { key: definition.key, label: definition.label, kind: definition.kind };
        const field = drafted.get(definition.key);
        const value = normalize(field?.value, cleanup);
        const { citations, invalid } = ProvenanceValidator.resolve(field?.sourceRefs ?? [], refs);
        invalid.forEach((ref) => invalidRefs.add(ref));

        if (value && !citations.length) {
          discarded.push({ key: definition.key, label: definition.label, value });
          return { ...base, value: null, origin: null, citations: [] };
        }
        return SdsSectionContentMapper.withDerived(
          { ...base, value, origin: value ? 'agent' : null, citations: value ? citations : [] },
          language,
        );
      }),
    }));

    return SectionSuggestionBuilder.finish(subsections, {
      conflicts: draft.conflicts,
      confidence: draft.confidence,
      invalidRefs: [...invalidRefs],
      discarded,
    });
  }

  /** Desde valores que NO vienen de la IA: lo que mandó el usuario (`request`) o lo que arma el sistema. */
  static fromValues(
    section: SdsSectionDefinition,
    values: Record<string, string | null | undefined>,
    origin: 'request' | 'system',
    language: string,
  ): SdsSectionSuggestionDTO {
    const subsections = section.subsections.map((sub) => ({
      code: sub.code,
      title: sub.title,
      fields: sub.fields.map((definition): SdsFieldDTO => {
        const value = values[definition.key]?.trim() || null;
        return SdsSectionContentMapper.withDerived(
          {
            key: definition.key,
            label: definition.label,
            kind: definition.kind,
            value,
            origin: value ? origin : null,
            citations: [],
          },
          language,
        );
      }),
    }));
    return SectionSuggestionBuilder.finish(subsections, {
      conflicts: [],
      confidence: null,
      invalidRefs: [],
      discarded: [],
    });
  }

  /** Desde datos estructurados de las fuentes, sin IA: cada campo queda citado a las fuentes de donde salió. */
  static fromSources(
    section: SdsSectionDefinition,
    values: Record<string, SourcedValue | undefined>,
    language: string,
  ): SdsSectionSuggestionDTO {
    const subsections = section.subsections.map((sub) => ({
      code: sub.code,
      title: sub.title,
      fields: sub.fields.map((definition): SdsFieldDTO => {
        const value = values[definition.key]?.value?.trim() || null;
        return SdsSectionContentMapper.withDerived(
          {
            key: definition.key,
            label: definition.label,
            kind: definition.kind,
            value,
            origin: value ? 'source' : null,
            citations: value ? (values[definition.key]?.citations ?? []) : [],
          },
          language,
        );
      }),
    }));
    return SectionSuggestionBuilder.finish(subsections, {
      conflicts: [],
      confidence: null,
      invalidRefs: [],
      discarded: [],
    });
  }

  private static finish(
    subsections: SdsSubsectionDTO[],
    rest: Pick<SdsSectionSuggestionDTO, 'conflicts' | 'confidence' | 'invalidRefs' | 'discarded'>,
  ): SdsSectionSuggestionDTO {
    return {
      subsections,
      content: SdsSectionContentMapper.render(subsections),
      missingData: SdsSectionContentMapper.missing(subsections),
      ...rest,
    };
  }
}

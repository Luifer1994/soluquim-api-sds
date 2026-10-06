import { SdsProductKind } from '@/modules/knowledge';
import { CurrentSourceData } from '@/modules/substance';
import { SdsCitationDTO, SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument/dto/response';
import { SdsSectionContentMapper } from '@/modules/sds/sdsdocument/mapper';

interface HarmonisedEntry {
  hazardClasses?: Array<{ code?: string; hazardStatements?: Array<{ code?: string }> }>;
}

/** Sección que lleva un campo por clase de peligro para la salud. */
const TOXICOLOGY_SECTION = 11;

/** Campo de la sección 11 → abreviaturas CLP de las clases de peligro que le corresponden. */
const ENDPOINT_CLASSES: Record<string, string[]> = {
  acuteToxicity: ['Acute Tox.'],
  skinCorrosionIrritation: ['Skin Corr.', 'Skin Irrit.'],
  eyeDamageIrritation: ['Eye Dam.', 'Eye Irrit.'],
  sensitization: ['Resp. Sens.', 'Skin Sens.'],
  germCellMutagenicity: ['Muta.'],
  carcinogenicity: ['Carc.'],
  reproductiveToxicity: ['Repr.', 'Lact.'],
  stotSingleExposure: ['STOT SE'],
  stotRepeatedExposure: ['STOT RE'],
  aspirationHazard: ['Asp. Tox.'],
};

const TEXT = {
  es: {
    classified: (classes: string) => `Clasificación armonizada (CLP, Anexo VI): ${classes}.`,
    notClassified: 'No clasificado para este peligro en la clasificación armonizada (CLP, Anexo VI).',
  },
  en: {
    classified: (classes: string) => `Harmonised classification (CLP, Annex VI): ${classes}.`,
    notClassified: 'Not classified for this hazard in the harmonised classification (CLP, Annex VI).',
  },
};

export interface EndpointInput {
  number: number;
  suggestion: SdsSectionSuggestionDTO | null;
  components: CurrentSourceData[];
  productKind: SdsProductKind;
  language: string;
}

/**
 * Sección 11 sin huecos y sin inventar: para cada clase de peligro que quedó vacía, dice lo que la
 * clasificación armonizada de la UE establece para ESE efecto — la clase y categoría si la tiene, o
 * que no está clasificado para ese peligro si la entrada armonizada no lo incluye. Es un hecho
 * verificable (la entrada del Anexo VI), citado a ECHA; solo aplica a componentes que TIENEN entrada
 * armonizada, y nunca pisa lo que ya llenó el agente o una fuente.
 */
export class ClassificationEndpointFiller {
  static fill(input: EndpointInput): SdsSectionSuggestionDTO | null {
    if (input.number !== TOXICOLOGY_SECTION || !input.suggestion) return input.suggestion;
    const text = input.language === 'en' ? TEXT.en : TEXT.es;

    const harmonised = input.components.flatMap((component) => {
      const source = component.sources.find((s) => s.source === 'ECHA' && s.status === 'OK');
      const record = source?.records.find((r) => r.field === 'ghs.harmonised');
      const entries = (Array.isArray(record?.value) ? record.value : []) as HarmonisedEntry[];
      if (!source || !record || !entries.length) return [];
      const citation: SdsCitationDTO = {
        ref: `ECHA:${component.cas}`,
        source: 'ECHA',
        cas: component.cas,
        title: `ECHA · ${component.substanceName ?? component.cas}`,
        sourceUrl: record.sourceUrl ?? source.sourceUrl ?? null,
      };
      return [{ component, citation, classes: entries.flatMap((entry) => entry.hazardClasses ?? []) }];
    });
    if (!harmonised.length) return input.suggestion;

    const empty = input.suggestion.subsections.flatMap((sub) =>
      sub.fields.filter((field) => field.value === null && ENDPOINT_CLASSES[field.key]),
    );
    return empty.reduce((suggestion, field) => {
      const lines = harmonised.map(({ component, classes }) => {
        const matching = classes.filter((c) =>
          ENDPOINT_CLASSES[field.key].some((prefix) => c.code?.startsWith(prefix)),
        );
        const statement = matching.length
          ? text.classified(
              matching
                .map((c) => [c.code, ...(c.hazardStatements ?? []).map((h) => h.code)].filter(Boolean).join(' — '))
                .join('; '),
            )
          : text.notClassified;
        return input.productKind === 'mixture'
          ? `${component.substanceName ?? component.cas}: ${statement}`
          : statement;
      });
      return (
        SdsSectionContentMapper.applyChange(
          suggestion,
          field.key,
          { value: lines.join('\n'), origin: 'source', citations: harmonised.map((h) => h.citation) },
          input.language,
        ) ?? suggestion
      );
    }, input.suggestion);
  }
}

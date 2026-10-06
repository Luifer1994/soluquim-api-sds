import { SdsProductKind, SdsSectionCatalog } from '@/modules/knowledge';
import { SourceRecord } from '@/modules/source';
import { CurrentSourceData } from '@/modules/substance';
import { SdsCitationDTO, SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument/dto/response';
import { SdsSectionContentMapper } from '@/modules/sds/sdsdocument/mapper';
import { SectionSuggestionBuilder } from '@/modules/sds/sdsgeneration/assembler/SectionSuggestionBuilder';

/** De dónde sale un campo de la plantilla cuando el agente lo dejó vacío. */
interface FallbackRule {
  /** Campo normalizado de la fuente (`firstAid.byRoute`, `physical.flashPoint`…). */
  field: string;
  /** Fuente de la que se toma (las reglas de texto usan fuentes en español). */
  source: string;
  /** Extrae el texto del valor del registro. Sin `pick`, el valor debe ser un texto. */
  pick?: (value: unknown, record: SourceRecord) => string | null;
  /** Dato numérico o código: vale en cualquier idioma. Sin esto, la regla solo aplica a fichas en español. */
  neutral?: boolean;
}

type Rules = Record<number, Record<string, FallbackRule[]>>;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const at =
  (...path: string[]) =>
  (value: unknown): string | null =>
    text(path.reduce<unknown>((node, key) => (node as Record<string, unknown> | null)?.[key], value));
/** "Presión de vapor, kPa a 20°C: 24" — cuando la unidad o la condición vienen en la etiqueta de la fuente. */
const labelled = (value: unknown, record: SourceRecord): string | null =>
  text(value) && `${record.label}: ${text(value)}`;
const list = (value: unknown): string | null =>
  Array.isArray(value) && value.length ? value.map(String).join('\n') : null;

const ROUTES: Array<[key: string, label: string]> = [
  ['inhalation', 'Inhalación'],
  ['skin', 'Piel'],
  ['eyes', 'Ojos'],
  ['ingestion', 'Ingestión'],
];
const symptomsByRoute = (value: unknown): string | null =>
  ROUTES.map(([key, label]) => [label, at(key, 'symptoms')(value)] as const)
    .filter(([, symptoms]) => symptoms)
    .map(([label, symptoms]) => `${label}: ${symptoms}`)
    .join('\n') || null;

const icsc = (field: string, pick?: FallbackRule['pick'], neutral = false): FallbackRule => ({
  field,
  source: 'ICSC',
  pick,
  neutral,
});

/**
 * Campo de la plantilla → registros de las fuentes que lo responden directamente. Solo correspondencias
 * uno a uno y sin interpretación (el dato de la fuente ES el contenido del campo).
 */
const RULES: Rules = {
  4: {
    inhalation: [icsc('firstAid.byRoute', at('inhalation'))],
    skin: [icsc('firstAid.byRoute', at('skin'))],
    eyes: [icsc('firstAid.byRoute', at('eyes'))],
    ingestion: [icsc('firstAid.byRoute', at('ingestion'))],
    symptoms: [icsc('exposure.byRoute', symptomsByRoute)],
  },
  5: {
    suitableMedia: [icsc('fire.extinguishing')],
    specificHazards: [icsc('fire.hazards')],
  },
  6: { cleanupMethods: [icsc('spill.measures')] },
  7: {
    safeHandling: [icsc('fire.prevention')],
    storageConditions: [icsc('storage.conditions')],
  },
  8: { exposureLimits: [icsc('exposure.occupationalLimits', list)] },
  9: {
    physicalState: [icsc('physical.appearance')],
    meltingPoint: [icsc('physical.meltingPoint', undefined, true)],
    boilingPoint: [icsc('physical.boilingPoint', undefined, true)],
    explosiveLimits: [icsc('physical.explosiveLimits', labelled)],
    flashPoint: [icsc('physical.flashPoint', undefined, true)],
    autoIgnitionTemperature: [icsc('physical.autoIgnitionTemperature', undefined, true)],
    viscosity: [icsc('physical.viscosity')],
    waterSolubility: [icsc('physical.waterSolubility', labelled)],
    partitionCoefficient: [icsc('physical.logPow', undefined, true)],
    vaporPressure: [icsc('physical.vaporPressure', labelled)],
    density: [icsc('physical.relativeDensity', labelled)],
    relativeVaporDensity: [icsc('physical.relativeVaporDensity', labelled)],
  },
  10: { hazardousReactions: [icsc('reactivity.chemicalDangers')] },
  11: {
    stotSingleExposure: [icsc('health.shortTermEffects')],
    stotRepeatedExposure: [icsc('health.longTermEffects')],
    additionalInformation: [icsc('health.routesOfExposure')],
  },
  12: { otherAdverseEffects: [icsc('ecology.environment')] },
  14: {
    unNumber: [icsc('transport.unNumber', (value) => text(value) && `UN${text(value)}`, true)],
    transportHazardClass: [icsc('transport.unHazardClass', undefined, true)],
    packingGroup: [icsc('transport.packingGroup', undefined, true)],
  },
};

export interface FallbackInput {
  number: number;
  /** Lo que armó el agente; null si su llamada falló. */
  suggestion: SdsSectionSuggestionDTO | null;
  components: CurrentSourceData[];
  productKind: SdsProductKind;
  language: string;
}

/**
 * Red de seguridad SIN IA: si el agente dejó vacío un campo (o falló toda su llamada) y una fuente trae
 * ese dato tal cual, el campo se llena con el dato de la fuente, citado y marcado como `source`. Nunca
 * pisa lo que escribió el agente. Así una ficha no queda con huecos teniendo el dato en las fuentes.
 */
export class SourceFallbackFiller {
  static fill(input: FallbackInput): SdsSectionSuggestionDTO | null {
    const rules = RULES[input.number];
    if (!rules) return input.suggestion;

    const base =
      input.suggestion ??
      SectionSuggestionBuilder.fromSources(
        SdsSectionCatalog.forProduct(input.number, input.productKind),
        {},
        input.language,
      );
    const empty = base.subsections.flatMap((sub) => sub.fields.filter((field) => field.value === null));

    let filled = false;
    const result = empty.reduce((suggestion, field) => {
      const sourced = SourceFallbackFiller.resolve(rules[field.key] ?? [], input);
      if (!sourced) return suggestion;
      filled = true;
      return (
        SdsSectionContentMapper.applyChange(
          suggestion,
          field.key,
          { value: sourced.value, origin: 'source', citations: sourced.citations },
          input.language,
        ) ?? suggestion
      );
    }, base);

    // Si el agente falló y las fuentes tampoco aportan nada, la sección sigue sin sugerencia.
    return input.suggestion || filled ? result : null;
  }

  private static resolve(
    rules: FallbackRule[],
    input: FallbackInput,
  ): { value: string; citations: SdsCitationDTO[] } | null {
    const blocks = input.components.flatMap((component) => {
      for (const rule of rules.filter((r) => r.neutral || input.language === 'es')) {
        const source = component.sources.find((s) => s.source === rule.source && s.status === 'OK');
        const record = source?.records.find((r) => r.field === rule.field);
        const value = record && (rule.pick ? rule.pick(record.value, record) : text(record.value));
        if (source && record && value) {
          return [
            {
              // En una mezcla cada dato se atribuye a su componente.
              text: input.productKind === 'mixture' ? `${component.substanceName ?? component.cas}: ${value}` : value,
              citation: {
                ref: `${source.source}:${component.cas}`,
                source: source.source,
                cas: component.cas,
                title: `${source.source} · ${component.substanceName ?? component.cas}`,
                sourceUrl: record.sourceUrl ?? source.sourceUrl ?? null,
              },
            },
          ];
        }
      }
      return [];
    });
    if (!blocks.length) return null;
    return { value: blocks.map((b) => b.text).join('\n'), citations: blocks.map((b) => b.citation) };
  }
}

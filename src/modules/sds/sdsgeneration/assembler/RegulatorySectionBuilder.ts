import { SdsProductKind, SdsSectionCatalog } from '@/modules/knowledge';
import { COUNTRY_PROFILE_CITATION_SOURCE } from '@/modules/reference';
import { CurrentSourceData } from '@/modules/substance';
import { SdsCitationDTO, SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument/dto/response';
import { SectionSuggestionBuilder, SourcedValue } from '@/modules/sds/sdsgeneration/assembler/SectionSuggestionBuilder';
import { CountryRegulatoryProfile } from '@/modules/sds/sdsgeneration/country';

type SourceEntry = CurrentSourceData['sources'][number];
type Line = { text: string; citation: SdsCitationDTO };

interface HarmonisedEntry {
  indexNumber?: string;
  atp?: string;
  status?: string;
  effectiveDate?: string;
  notes?: Array<{ code?: string } | string>;
}
interface IarcEntry {
  agent?: string;
  group?: string;
  groupDescription?: string;
  volumes?: string[];
  publicationYear?: number;
}
interface InsstLimits {
  vlaEd?: { ppm?: string | null; mgM3?: string | null };
  vlaEc?: { ppm?: string | null; mgM3?: string | null };
}

const join = (parts: Array<string | number | null | undefined | false>, separator = ' · '): string =>
  parts.filter(Boolean).join(separator);
const limit = (label: string, value?: { ppm?: string | null; mgM3?: string | null }): string | null => {
  const amounts = join([value?.ppm, value?.mgM3], ' / ');
  return amounts ? `${label}: ${amounts}` : null;
};

/**
 * Sección 15 (información reglamentaria) SIN IA: es un volcado ordenado de lo que las fuentes ya traen
 * estructurado (clasificación armonizada y procesos de ECHA, lista de valores límite del INSST,
 * monografías IARC, notas de la ICSC). Cada dato queda citado a su fuente. Función pura.
 */
export class RegulatorySectionBuilder {
  static section15(
    components: CurrentSourceData[],
    productKind: SdsProductKind,
    language: string,
    country?: CountryRegulatoryProfile,
  ): SdsSectionSuggestionDTO {
    const collect = (pick: (component: CurrentSourceData) => Line[]): SourcedValue => {
      const blocks = components
        .map((component) => ({ component, lines: pick(component) }))
        .filter((block) => block.lines.length);
      const citations = new Map(blocks.flatMap((b) => b.lines.map((l) => [l.citation.ref, l.citation] as const)));
      const text = blocks
        .map(({ component, lines }) => {
          const body = lines.map((line) => line.text).join('\n');
          // En una mezcla cada dato se atribuye a su componente.
          return productKind === 'mixture'
            ? `${component.substanceName ?? component.cas} (CAS ${component.cas}):\n${body}`
            : body;
        })
        .join('\n\n');
      return { value: text || null, citations: [...citations.values()] };
    };

    return SectionSuggestionBuilder.fromSources(
      SdsSectionCatalog.forProduct(15, productKind),
      {
        // Normativa del país de destino: del perfil del país (procedimiento aprobado), no de las fuentes.
        nationalRegulations: country
          ? {
              value: country.regulations.join('\n'),
              citations: [
                {
                  ref: country.code,
                  source: COUNTRY_PROFILE_CITATION_SOURCE,
                  cas: null,
                  title: `${country.name}: ${country.basis}`,
                  sourceUrl: null,
                },
              ],
            }
          : undefined,
        euHarmonisedClassification: collect((c) =>
          RegulatorySectionBuilder.records<HarmonisedEntry[]>(c, 'ghs.harmonised').flatMap(({ value, citation }) =>
            (Array.isArray(value) ? value : []).map((entry) => ({
              citation,
              text: join([
                entry.indexNumber && `No. de índice ${entry.indexNumber}`,
                entry.atp,
                entry.status,
                entry.effectiveDate && `desde ${entry.effectiveDate}`,
                entry.notes?.length &&
                  `notas: ${entry.notes.map((note) => (typeof note === 'string' ? note : note.code)).join(', ')}`,
              ]),
            })),
          ),
        ),
        euRegulatoryProcesses: collect((c) =>
          RegulatorySectionBuilder.records<string[]>(c, 'regulatory.echaProcesses')
            .filter(({ value }) => Array.isArray(value) && value.length)
            .map(({ value, citation }) => ({ citation, text: [...value].sort().join(', ') })),
        ),
        occupationalExposureRegulation: collect((c) => [
          ...RegulatorySectionBuilder.records<InsstLimits>(c, 'exposure.oel.es').map(({ value, citation }) => ({
            citation,
            text: join([
              join(
                ['INSST (España)', RegulatorySectionBuilder.records<string>(c, 'regulatory.insstYear')[0]?.value],
                ', ',
              ),
              limit('VLA-ED', value?.vlaEd),
              limit('VLA-EC', value?.vlaEc),
            ]),
          })),
          ...RegulatorySectionBuilder.records<Array<{ code?: string; text?: string }>>(
            c,
            'regulatory.insstNotes',
          ).flatMap(({ value, citation }) =>
            (Array.isArray(value) ? value : []).map((note) => ({
              citation,
              text: join([note.code && `Nota ${note.code}`, note.text], ': '),
            })),
          ),
        ]),
        carcinogenListings: collect((c) =>
          RegulatorySectionBuilder.records<IarcEntry[]>(c, 'carcinogenicity.iarc').flatMap(({ value, citation }) =>
            (Array.isArray(value) ? value : []).map((entry) => ({
              citation,
              text: join([
                join([entry.group && `IARC Grupo ${entry.group}`, entry.groupDescription], ' — '),
                entry.agent,
                entry.volumes?.length && `Monografías vol. ${entry.volumes.join(', ')}`,
                entry.publicationYear && String(entry.publicationYear),
              ]),
            })),
          ),
        ),
        otherRegulations: collect((c) =>
          RegulatorySectionBuilder.records<string>(c, 'regulatory.additionalInformation')
            .filter(({ value }) => typeof value === 'string' && value.trim())
            .map(({ value, citation }) => ({ citation, text: value.trim() })),
        ),
      },
      language,
    );
  }

  /** Los registros de un campo en todas las fuentes OK del componente, con la cita de su fuente. */
  private static records<T>(
    component: CurrentSourceData,
    field: string,
  ): Array<{ value: T; citation: SdsCitationDTO }> {
    return component.sources
      .filter((source: SourceEntry) => source.status === 'OK')
      .flatMap((source: SourceEntry) =>
        source.records
          .filter((record) => record.field === field)
          .map((record) => ({
            value: record.value as T,
            citation: {
              ref: `${source.source}:${component.cas}`,
              source: source.source,
              cas: component.cas,
              title: `${source.source} · ${component.substanceName ?? component.cas}`,
              sourceUrl: record.sourceUrl ?? source.sourceUrl ?? null,
            },
          })),
      );
  }
}

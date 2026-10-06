import { SdsSectionCatalog } from '@/modules/knowledge';
import { CurrentSourceData } from '@/modules/substance';
import { SdsSourceEvidenceDTO } from '@/modules/sds/sdsdocument/dto/response';

/**
 * Lo que cada fuente aporta a cada sección, SIN IA (función pura): los registros de las fuentes de
 * cada componente, filtrados por las secciones que alimentan. Es lo que el usuario puede elegir en vez
 * de la sugerencia del agente.
 */
export class SectionEvidenceCollector {
  static collect(components: CurrentSourceData[], section: number): SdsSourceEvidenceDTO[] {
    return components.flatMap((component) =>
      component.sources
        .filter((source) => source.status === 'OK')
        .map((source) => ({
          cas: component.cas,
          componentName: component.substanceName,
          source: source.source,
          sourceVersion: source.version,
          sourceUrl: source.sourceUrl,
          records: source.records.filter(
            (record) =>
              !record.field.startsWith('meta.') && SdsSectionCatalog.sectionsForField(record.field).includes(section),
          ),
        }))
        .filter((evidence) => evidence.records.length > 0),
    );
  }
}

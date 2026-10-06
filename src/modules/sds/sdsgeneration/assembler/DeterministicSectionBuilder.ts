import { GhsStatementCatalog, SdsProductKind, SdsSectionCatalog } from '@/modules/knowledge';
import { CurrentSourceData } from '@/modules/substance';
import { SdsSectionSuggestionDTO } from '@/modules/sds/sdsdocument/dto/response';
import { SectionSuggestionBuilder } from '@/modules/sds/sdsgeneration/assembler/SectionSuggestionBuilder';
import { GenerateSdsRequestDTO } from '@/modules/sds/sdsgeneration/dto/request';

/** Secciones de donde salen las indicaciones H cuyo texto íntegro va en la 16. */
const H_STATEMENT_SECTIONS = [2, 3];

export interface Section16Input {
  generatedAt: Date;
  language: string;
  productKind: SdsProductKind;
  components: CurrentSourceData[];
  /** Las secciones ya armadas (de ahí se toman las frases H citadas). */
  sections: ReadonlyMap<number, SdsSectionSuggestionDTO>;
}

/**
 * Secciones que NUNCA pasan por la IA (funciones puras):
 *  - Sección 1 (identificación): por ahora solo lo básico —nombre y CAS del producto— y solo lo que
 *    mandó el usuario en la solicitud. Lo que no mandó queda vacío; jamás se completa ni se deduce.
 *  - Sección 16 (otra información): la arma el sistema (fecha, texto de las frases H y fuentes consultadas).
 */
export class DeterministicSectionBuilder {
  static section1(request: GenerateSdsRequestDTO, productKind: SdsProductKind): SdsSectionSuggestionDTO {
    const single = request.components.length === 1 ? request.components[0] : undefined;
    return SectionSuggestionBuilder.fromValues(
      SdsSectionCatalog.forProduct(1, productKind),
      {
        productName: request.product?.name,
        // CAS del producto: el que mandó el usuario; si no, el del componente cuando es una sola sustancia.
        // Una mezcla sin CAS propio queda vacía (sus componentes van en la sección 3).
        casNumber: request.product?.cas ?? single?.cas,
      },
      'request',
      request.language,
    );
  }

  static section16(input: Section16Input): SdsSectionSuggestionDTO {
    const sources = new Map<string, string>();
    for (const component of input.components) {
      for (const source of component.sources.filter((s) => s.status === 'OK')) {
        const attribution = source.records.find((record) => record.field === 'meta.attribution')?.value;
        if (!sources.has(source.source)) {
          sources.set(
            source.source,
            typeof attribution === 'string' ? `${source.source} — ${attribution}` : source.source,
          );
        }
      }
    }

    // Texto íntegro de las frases H citadas en las secciones 2 y 3: del catálogo oficial, no de la IA.
    const cited = H_STATEMENT_SECTIONS.flatMap(
      (number) => input.sections.get(number)?.subsections.flatMap((sub) => sub.fields.map((f) => f.value)) ?? [],
    ).join('\n');
    const hStatements = GhsStatementCatalog.parse(cited, input.language)
      .filter((statement) => /^(EU)?H/.test(statement.code) && statement.text)
      .sort((a, b) => a.code.localeCompare(b.code));

    return SectionSuggestionBuilder.fromValues(
      SdsSectionCatalog.forProduct(16, input.productKind),
      {
        preparationDate: input.generatedAt.toISOString().slice(0, 10),
        hStatementsFullText: GhsStatementCatalog.render(hStatements) || null,
        dataSources: [...sources.values()].join('\n') || null,
      },
      'system',
      input.language,
    );
  }
}

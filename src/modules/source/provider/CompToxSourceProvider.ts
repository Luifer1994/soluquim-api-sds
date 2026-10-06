import { Injectable } from '@nestjs/common';
import { ExternalHttpClient } from '@/shared/http';
import { ResilienceOptions } from '@/shared/resilience';
import { BaseSourceProvider, SourceFetchOutput } from '@/modules/source/base';
import { SourceInfo, SourceRecord } from '@/modules/source/dto';
import { SourceCodeEnum, SourceKindEnum } from '@/modules/source/enums';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';
import {
  CompToxHazardResponse,
  CompToxParser,
  CompToxPropertiesResponse,
  CompToxSearchResponseItem,
} from '@/modules/source/parser';

const API = 'https://comptox.epa.gov/dashboard-api';

/**
 * EPA CompTox Chemicals Dashboard — API JSON que usa el propio dashboard (sin clave).
 * Aporta propiedades físico-químicas experimentales y predichas (sección 9) y toxicidad aguda
 * DL50/CL50 de ToxValDB (sección 11, y ETA para la mezcla). No trae datos ecotoxicológicos ni SGA.
 *
 * OJO: es el backend del dashboard, no una API publicada con contrato: puede cambiar sin aviso. La
 * alternativa oficial es la CTX API (api-ccte.epa.gov) con clave propia (`x-api-key`).
 */
@Injectable()
export class CompToxSourceProvider extends BaseSourceProvider {
  readonly code = SourceCodeEnum.COMPTOX;
  readonly cacheTtlDays = 60;
  readonly info: SourceInfo = {
    name: 'EPA CompTox Chemicals Dashboard',
    owner: 'Agencia de Protección Ambiental (EPA, EE. UU.)',
    kind: SourceKindEnum.API_JSON,
    homepage: 'https://comptox.epa.gov/dashboard',
    sdsSections: [9, 11],
    description:
      'Propiedades físico-químicas (experimentales y predichas) y toxicidad aguda DL50/CL50 por vía y especie.',
  };

  constructor(private readonly http: ExternalHttpClient) {
    super();
  }

  protected override resilience(): Partial<ResilienceOptions> {
    // La respuesta de peligros puede pesar >1 MB.
    return { timeoutMs: 25_000, maxAttempts: 2, maxConcurrent: 2 };
  }

  protected async performFetch(cas: string, signal: AbortSignal): Promise<SourceFetchOutput> {
    const search = await this.http.getJson<CompToxSearchResponseItem[]>(
      `${API}/ccdapp1/search/chemical/equal-with-detail/${encodeURIComponent(cas)}`,
      signal,
    );
    const chemical = CompToxParser.pickByCas(search.body, cas);
    if (!chemical) throw new SubstanceNotFoundInSourceError(this.code, cas);

    const sourceUrl = CompToxParser.detailsUrl(chemical.dtxsid);
    const [properties, hazard] = await Promise.all([
      this.http.getJson<CompToxPropertiesResponse>(
        `${API}/ccdapp2/chemical-property/search/by-dtxsid?id=${chemical.dtxsid}`,
        signal,
      ),
      this.http.getJson<CompToxHazardResponse>(`${API}/ccdapp1/hazard/search/by-dtxsid?id=${chemical.dtxsid}`, signal),
    ]);

    const records: SourceRecord[] = [
      { field: 'identity.dtxsid', label: 'DSSTox Substance ID', value: chemical.dtxsid, sourceUrl },
      { field: 'identity.name', label: 'Preferred name', value: chemical.preferredName, sourceUrl },
      { field: 'identity.molecularFormula', label: 'Molecular formula', value: chemical.molFormula, sourceUrl },
      {
        field: 'identity.molecularWeight',
        label: 'Average mass',
        value: chemical.averageMass,
        unit: 'g/mol',
        sourceUrl,
      },
      ...CompToxParser.parseProperties(properties.body, `${sourceUrl}#properties`),
      ...CompToxParser.parseAcuteToxicity(hazard.body, `${sourceUrl}#hazard`),
    ].filter((record) => record.value !== undefined);

    return {
      records,
      sourceUrl,
      raw: {
        url: sourceUrl,
        contentType: 'application/json',
        // Sin el crudo de peligros (>1 MB): ya está resumido en los registros y se puede volver a pedir.
        content: JSON.stringify({ chemical, properties: properties.body }),
      },
    };
  }
}

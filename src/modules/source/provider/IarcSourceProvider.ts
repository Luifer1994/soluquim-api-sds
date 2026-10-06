import { Injectable } from '@nestjs/common';
import { ExternalHttpClient } from '@/shared/http';
import { ResilienceOptions } from '@/shared/resilience';
import { BaseSourceProvider, CachedDataset, SourceFetchOutput } from '@/modules/source/base';
import { SourceInfo } from '@/modules/source/dto';
import { SourceCodeEnum, SourceKindEnum } from '@/modules/source/enums';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';
import { IARC_GROUP_DESCRIPTIONS, IarcAgent, IarcDataset, IarcParser } from '@/modules/source/parser';

const BUNDLE_URL = 'https://webapi.iarc.who.int/loc/loc.app.js';
const LIST_URL = 'https://monographs.iarc.who.int/list-of-classifications';
/** La IARC actualiza el listado unas pocas veces al año. */
const DATASET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GROUP_ORDER = ['1', '2A', '2B', '3'];

/**
 * IARC Monographs (OMS) — clasificación de carcinogenicidad (sección 11 de la FDS). Fuente tipo DATASET:
 * el listado completo (~1100 agentes) se descarga una vez a la semana y se consulta en memoria, así que
 * cada CAS no hace ninguna llamada a la red.
 */
@Injectable()
export class IarcSourceProvider extends BaseSourceProvider {
  readonly code = SourceCodeEnum.IARC;
  readonly cacheTtlDays = 30;
  override readonly notFoundTtlDays = 30;
  readonly info: SourceInfo = {
    name: 'IARC Monographs — List of Classifications',
    owner: 'Agencia Internacional de Investigación sobre el Cáncer (IARC / OMS)',
    kind: SourceKindEnum.DATASET,
    homepage: LIST_URL,
    sdsSections: [11, 15],
    description: 'Grupo de carcinogenicidad (1, 2A, 2B, 3), volúmenes de las monografías y año de evaluación.',
  };

  private readonly dataset = new CachedDataset<{ meta: IarcDataset; byCas: Map<string, IarcAgent[]> }>(
    DATASET_TTL_MS,
    async (signal) => {
      const response = await this.http.getText(BUNDLE_URL, signal, 'application/javascript');
      const meta = IarcParser.parseBundle(response.body);
      this.logger.log(
        `Listado IARC cargado: ${meta.agents.length} agentes (volumen ${meta.lastVolume}, ${meta.lastUpdate})`,
      );
      return { meta, byCas: IarcParser.indexByCas(meta) };
    },
  );

  constructor(private readonly http: ExternalHttpClient) {
    super();
  }

  protected override resilience(): Partial<ResilienceOptions> {
    return { timeoutMs: 20_000, maxAttempts: 2, maxConcurrent: 5 };
  }

  protected async performFetch(cas: string, signal: AbortSignal): Promise<SourceFetchOutput> {
    const { meta, byCas } = await this.dataset.get(signal);
    const agents = byCas.get(cas);
    if (!agents?.length) throw new SubstanceNotFoundInSourceError(this.code, cas);

    const classifications = agents
      .map((agent) => ({
        agent: IarcParser.stripHtml(agent.name) ?? agent.name,
        group: agent.group!,
        groupDescription: IARC_GROUP_DESCRIPTIONS[agent.group!] ?? agent.group!,
        volumes: agent.volume ?? [],
        publicationYear: agent.year,
        evaluationYear: agent.yeareval,
        inPreparation: agent.in_prep ?? false,
        comment: IarcParser.stripHtml(agent.comment),
      }))
      .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

    return {
      records: [
        { field: 'carcinogenicity.iarc', label: 'IARC classification', value: classifications, sourceUrl: LIST_URL },
        {
          field: 'carcinogenicity.iarcHighestGroup',
          label: 'Grupo IARC más alto',
          value: classifications[0].group,
          sourceUrl: LIST_URL,
        },
        {
          field: 'meta.datasetVersion',
          label: 'Versión del listado IARC',
          value: `Volumen ${meta.lastVolume} (${meta.lastUpdate})`,
          sourceUrl: LIST_URL,
        },
      ],
      sourceUrl: LIST_URL,
      raw: { url: LIST_URL, contentType: 'application/json', content: JSON.stringify(agents) },
    };
  }
}

import { Injectable } from '@nestjs/common';
import { ExternalHttpClient } from '@/shared/http';
import { ResilienceOptions } from '@/shared/resilience';
import { BaseSourceProvider, CachedDataset, SourceFetchOutput } from '@/modules/source/base';
import { SourceInfo } from '@/modules/source/dto';
import { SourceCodeEnum, SourceKindEnum } from '@/modules/source/enums';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';
import { NIOSH_NPG_BASE_URL, NioshIndexEntry, NioshNpgParser } from '@/modules/source/parser';

const CAS_INDEX_URL = `${NIOSH_NPG_BASE_URL}npgdcas.html`;
/** El índice cambia muy poco: se guarda en memoria y se refresca una vez al día. */
const INDEX_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * NIOSH Pocket Guide to Chemical Hazards (CDC) — fuente HTML (web scraping de páginas estáticas, sin
 * navegador headless). Aporta límites de exposición (REL, PEL, IDLH → sección 8), propiedades físicas
 * (sección 9), incompatibilidades (sección 10), primeros auxilios (sección 4) y EPP.
 *  1. CAS → página, con el índice oficial por CAS (`npgdcas.html`, cacheado en memoria).
 *  2. Descarga y parseo de la ficha.
 */
@Injectable()
export class NioshNpgSourceProvider extends BaseSourceProvider {
  readonly code = SourceCodeEnum.NIOSH_NPG;
  readonly info: SourceInfo = {
    name: 'NIOSH Pocket Guide to Chemical Hazards',
    owner: 'NIOSH / CDC (EE. UU.)',
    kind: SourceKindEnum.HTML,
    homepage: 'https://www.cdc.gov/niosh/npg/',
    sdsSections: [4, 8, 9, 10, 14],
    description:
      'Límites de exposición (REL, PEL, IDLH), propiedades físicas, incompatibilidades, primeros auxilios, EPP y número ONU.',
  };
  readonly cacheTtlDays = 90;
  /** La guía casi no cambia: un "no está" se puede cachear bastante. */
  override readonly notFoundTtlDays = 30;

  private readonly index = new CachedDataset<Map<string, NioshIndexEntry[]>>(INDEX_TTL_MS, async (signal) => {
    const response = await this.http.getText(CAS_INDEX_URL, signal);
    const entries = NioshNpgParser.parseCasIndex(response.body);
    if (entries.size < 100) throw new Error(`Índice NIOSH sospechoso: solo ${entries.size} CAS (¿cambió el HTML?)`);
    this.logger.log(`Índice NIOSH cargado: ${entries.size} CAS`);
    return entries;
  });

  constructor(private readonly http: ExternalHttpClient) {
    super();
  }

  protected override resilience(): Partial<ResilienceOptions> {
    return { timeoutMs: 15_000, maxAttempts: 3, maxConcurrent: 3 };
  }

  protected async performFetch(cas: string, signal: AbortSignal): Promise<SourceFetchOutput> {
    const entries = (await this.index.get(signal)).get(cas);
    if (!entries?.length) throw new SubstanceNotFoundInSourceError(this.code, cas);

    // Algunos CAS tienen varias fichas (p. ej. "vapor" y "dust"): se usa la primera y se informan las demás.
    const [main, ...alternatives] = entries;
    const sourceUrl = `${NIOSH_NPG_BASE_URL}${main.page}`;
    const page = await this.http.getText(sourceUrl, signal);

    const records = NioshNpgParser.parseChemicalPage(page.body, sourceUrl);
    if (alternatives.length) {
      records.push({
        field: 'niosh.alternativeEntries',
        label: 'Otras fichas NIOSH para este CAS',
        value: alternatives.map((alt) => ({ name: alt.name, url: `${NIOSH_NPG_BASE_URL}${alt.page}` })),
        sourceUrl: CAS_INDEX_URL,
      });
    }

    return { records, sourceUrl, raw: { url: sourceUrl, contentType: page.contentType, content: page.raw } };
  }
}

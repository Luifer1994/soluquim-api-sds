import { Injectable } from '@nestjs/common';
import { ExternalHttpClient } from '@/shared/http';
import { MinIntervalLimiter, ResilienceOptions } from '@/shared/resilience';
import { BaseSourceProvider, SourceFetchOutput } from '@/modules/source/base';
import { SourceInfo } from '@/modules/source/dto';
import { SourceCodeEnum, SourceKindEnum } from '@/modules/source/enums';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';
import { OshaParser } from '@/modules/source/parser';

/** robots.txt de osha.gov: `Crawl-delay: 10`. Se respeta entre CADA petición del proceso. */
const CRAWL_DELAY_MS = 10_000;

/**
 * OSHA Occupational Chemical Database — HTML. Límites OSHA PEL, NIOSH REL, ACGIH TLV© y Cal/OSHA PEL,
 * IDLH y clasificaciones de carcinogenicidad resumidas (secciones 8 y 11).
 *
 * Es lenta POR DISEÑO (10 s entre peticiones, 2 peticiones por CAS): corre en modo `background`. Si no
 * hay cache, la respuesta HTTP dice PENDING y el worker la consulta respetando el crawl-delay.
 * El sitio bloquea clientes que no parecen navegador: el ExternalHttpClient ya manda un User-Agent propio.
 */
@Injectable()
export class OshaSourceProvider extends BaseSourceProvider {
  readonly code = SourceCodeEnum.OSHA;
  readonly cacheTtlDays = 90;
  override readonly notFoundTtlDays = 30;
  override readonly mode = 'background' as const;
  /**
   * DESACTIVADA por defecto: osha.gov responde 403 a clientes que no se presentan como navegador
   * (filtro anti-bots). Hacerse pasar por un navegador sería evadir ese bloqueo, así que no se hace.
   * Activarla solo con autorización (SOURCES_ENABLED=…,OSHA) — p. ej. si OSHA habilita el acceso.
   */
  override readonly enabledByDefault = false;
  readonly info: SourceInfo = {
    name: 'OSHA Occupational Chemical Database',
    owner: 'Occupational Safety and Health Administration (OSHA, EE. UU.)',
    kind: SourceKindEnum.HTML,
    homepage: 'https://www.osha.gov/chemicaldata/',
    sdsSections: [8, 9, 11],
    description: 'Límites OSHA PEL, NIOSH REL, ACGIH TLV© y Cal/OSHA PEL, IDLH y clasificaciones de carcinogenicidad.',
  };

  private readonly limiter = new MinIntervalLimiter(CRAWL_DELAY_MS);

  constructor(private readonly http: ExternalHttpClient) {
    super();
  }

  protected override resilience(): Partial<ResilienceOptions> {
    // El timeout cubre también la espera del crawl-delay.
    return { timeoutMs: 60_000, maxAttempts: 2, maxConcurrent: 1, maxQueued: 200 };
  }

  protected async performFetch(cas: string, signal: AbortSignal): Promise<SourceFetchOutput> {
    const searchUrl = OshaParser.searchUrl(cas);
    const search = await this.limiter.schedule(() => this.http.getText(searchUrl, signal));
    const best = OshaParser.pickBest(OshaParser.parseSearch(search.body, cas));
    if (!best) throw new SubstanceNotFoundInSourceError(this.code, cas);

    const url = OshaParser.chemicalUrl(best.id);
    const page = await this.limiter.schedule(() => this.http.getText(url, signal));
    return {
      records: OshaParser.parseChemical(page.body, url),
      sourceUrl: url,
      raw: { url, contentType: page.contentType, content: page.raw },
    };
  }
}

import { Injectable } from '@nestjs/common';
import { ExternalHttpClient } from '@/shared/http';
import { ResilienceOptions } from '@/shared/resilience';
import { BaseSourceProvider, SourceFetchOutput } from '@/modules/source/base';
import { SourceInfo } from '@/modules/source/dto';
import { SourceCodeEnum, SourceKindEnum } from '@/modules/source/enums';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';
import { ICSC_BASE_URL, IcscParser } from '@/modules/source/parser';

/** Idiomas en orden de preferencia: la FDS se redacta en español; si la ficha no está traducida, inglés. */
const LANGUAGES = ['es', 'en'];

/**
 * ICSC — Fichas Internacionales de Seguridad Química (OIT / OMS), en español. Fuente HTML.
 * Es la más completa para redactar: incendio y extinción (5), primeros auxilios por vía (4),
 * derrames (6), almacenamiento (7), límites de exposición (8), propiedades (9), efectos sobre la
 * salud (11), medio ambiente (12), clasificación SGA (2) y transporte ONU (14).
 *  1. CAS → ficha (`showcard.listCards3?p_cas_number=`). Si hay varias, la de la sustancia pura.
 *  2. Ficha en español (`showcard.display?p_lang=es`); si no existe, en inglés.
 */
@Injectable()
export class IcscSourceProvider extends BaseSourceProvider {
  readonly code = SourceCodeEnum.ICSC;
  readonly cacheTtlDays = 90;
  override readonly notFoundTtlDays = 30;
  readonly info: SourceInfo = {
    name: 'ICSC — International Chemical Safety Cards',
    owner: 'OIT / OMS (versión en español: INSST)',
    kind: SourceKindEnum.HTML,
    homepage: 'https://chemicalsafety.ilo.org/dyn/icsc/showcard.home',
    sdsSections: [2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14],
    description:
      'Fichas en español: incendio, primeros auxilios por vía, derrames, almacenamiento, SGA, ONU, propiedades, salud y medio ambiente.',
  };

  constructor(private readonly http: ExternalHttpClient) {
    super();
  }

  protected override resilience(): Partial<ResilienceOptions> {
    return { timeoutMs: 15_000, maxAttempts: 3, maxConcurrent: 2 };
  }

  protected async performFetch(cas: string, signal: AbortSignal): Promise<SourceFetchOutput> {
    const searchUrl = `${ICSC_BASE_URL}showcard.listCards3?p_lang=en&p_cas_number=${encodeURIComponent(cas)}`;
    const results = IcscParser.parseSearch((await this.http.getText(searchUrl, signal)).body);
    const best = IcscParser.pickBest(results);
    if (!best) throw new SubstanceNotFoundInSourceError(this.code, cas);

    for (const language of LANGUAGES) {
      const url = `${ICSC_BASE_URL}showcard.display?p_lang=${language}&p_card_id=${best.cardId}&p_version=${best.version}`;
      const page = await this.http.getText(url, signal);
      if (IcscParser.isCardNotFound(page.body)) continue;

      const records = IcscParser.parseCard(page.body, url, language);
      const alternatives = results.filter((result) => result.cardId !== best.cardId);
      if (alternatives.length) {
        records.push({
          field: 'icsc.alternativeCards',
          label: 'Otras fichas ICSC para este CAS',
          value: alternatives.map((alt) => ({
            name: alt.name,
            url: `${ICSC_BASE_URL}showcard.display?p_lang=${language}&p_card_id=${alt.cardId}&p_version=${alt.version}`,
          })),
          sourceUrl: searchUrl,
        });
      }
      return { records, sourceUrl: url, raw: { url, contentType: page.contentType, content: page.raw } };
    }
    throw new SubstanceNotFoundInSourceError(this.code, cas);
  }
}

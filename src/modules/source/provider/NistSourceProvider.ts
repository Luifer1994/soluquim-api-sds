import { Injectable } from '@nestjs/common';
import { ExternalHttpClient } from '@/shared/http';
import { ResilienceOptions } from '@/shared/resilience';
import { BaseSourceProvider, SourceFetchOutput } from '@/modules/source/base';
import { SourceInfo } from '@/modules/source/dto';
import { SourceCodeEnum, SourceKindEnum } from '@/modules/source/enums';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';
import { NistParser } from '@/modules/source/parser';

/**
 * NIST Chemistry WebBook (SRD 69) — HTML. Constantes termodinámicas evaluadas, con referencia por
 * valor: puntos de ebullición/fusión, críticos, entalpías (sección 9). Una sola petición por CAS
 * (`Mask=7`). Datos con copyright del SRD Act: se citan (`meta.attribution`) y se cachean.
 */
@Injectable()
export class NistSourceProvider extends BaseSourceProvider {
  readonly code = SourceCodeEnum.NIST;
  readonly cacheTtlDays = 180;
  override readonly notFoundTtlDays = 60;
  readonly info: SourceInfo = {
    name: 'NIST Chemistry WebBook (SRD 69)',
    owner: 'National Institute of Standards and Technology (NIST, EE. UU.)',
    kind: SourceKindEnum.HTML,
    homepage: 'https://webbook.nist.gov/chemistry/',
    sdsSections: [9],
    description: 'Constantes termodinámicas evaluadas con referencia: ebullición, fusión, punto crítico, entalpías.',
  };

  constructor(private readonly http: ExternalHttpClient) {
    super();
  }

  protected override resilience(): Partial<ResilienceOptions> {
    return { timeoutMs: 20_000, maxAttempts: 3, maxConcurrent: 2 };
  }

  protected async performFetch(cas: string, signal: AbortSignal): Promise<SourceFetchOutput> {
    const url = NistParser.pageUrl(cas);
    const page = await this.http.getText(url, signal);
    if (NistParser.isNotFound(page.body)) throw new SubstanceNotFoundInSourceError(this.code, cas);
    return {
      records: NistParser.parse(page.body, url),
      sourceUrl: url,
      raw: { url, contentType: page.contentType, content: page.raw },
    };
  }
}

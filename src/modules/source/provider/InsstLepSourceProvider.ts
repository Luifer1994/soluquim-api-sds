import { Injectable } from '@nestjs/common';
import { ExternalHttpClient } from '@/shared/http';
import { ResilienceOptions } from '@/shared/resilience';
import { BaseSourceProvider, SourceFetchOutput } from '@/modules/source/base';
import { SourceInfo } from '@/modules/source/dto';
import { SourceCodeEnum, SourceKindEnum } from '@/modules/source/enums';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';
import { INSST_LEP_BASE_URL, InsstLepParser } from '@/modules/source/parser';

/**
 * INSST — Límites de Exposición Profesional para Agentes Químicos (España), HTML. Valores oficiales
 * VLA-ED / VLA-EC para la sección 8 en español. Reemplaza a "Buscatox" del plan, que resultó ser un
 * directorio de enlaces sin datos propios.
 */
@Injectable()
export class InsstLepSourceProvider extends BaseSourceProvider {
  readonly code = SourceCodeEnum.INSST_LEP;
  readonly cacheTtlDays = 90;
  override readonly notFoundTtlDays = 30;
  readonly info: SourceInfo = {
    name: 'INSST — Límites de Exposición Profesional (LEP)',
    owner: 'Instituto Nacional de Seguridad y Salud en el Trabajo (España)',
    kind: SourceKindEnum.HTML,
    homepage: 'https://bdlep.insst.es/LEP/',
    sdsSections: [8, 15],
    description: 'Valores Límite Ambientales oficiales de España: VLA-ED y VLA-EC (ppm y mg/m³), notas (VLB, VLI…).',
  };

  constructor(private readonly http: ExternalHttpClient) {
    super();
  }

  protected override resilience(): Partial<ResilienceOptions> {
    return { timeoutMs: 15_000, maxAttempts: 3, maxConcurrent: 2 };
  }

  protected async performFetch(cas: string, signal: AbortSignal): Promise<SourceFetchOutput> {
    const searchUrl = `${INSST_LEP_BASE_URL}bucaspr.jsp?casBusqueda=${encodeURIComponent(cas)}&submit=Buscar`;
    const href = InsstLepParser.parseSearch((await this.http.getText(searchUrl, signal)).body, cas);
    if (!href) throw new SubstanceNotFoundInSourceError(this.code, cas);

    const url = new URL(href, INSST_LEP_BASE_URL).toString();
    const page = await this.http.getText(url, signal);
    return {
      records: InsstLepParser.parseAgent(page.body, url),
      sourceUrl: url,
      raw: { url, contentType: page.contentType, content: page.raw },
    };
  }
}

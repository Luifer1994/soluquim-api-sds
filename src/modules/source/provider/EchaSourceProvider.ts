import { Injectable } from '@nestjs/common';
import { ExternalHttpClient } from '@/shared/http';
import { ResilienceOptions } from '@/shared/resilience';
import { BaseSourceProvider, SourceFetchOutput } from '@/modules/source/base';
import { SourceInfo, SourceRecord } from '@/modules/source/dto';
import { SourceCodeEnum, SourceKindEnum } from '@/modules/source/enums';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';
import {
  ECHA_ATTRIBUTION,
  ECHA_BASE_URL,
  EchaAteResponse,
  EchaClassificationListResponse,
  EchaClassificationResponse,
  EchaLabellingResponse,
  EchaNotesResponse,
  EchaParser,
  EchaPictogramsResponse,
  EchaScl,
  EchaSearchResponse,
} from '@/modules/source/parser';

const API = `${ECHA_BASE_URL}/api-cnl-inventory`;
/** Entradas armonizadas a detallar (casi siempre hay 1; algunas sustancias tienen 2). */
const MAX_HARMONISED = 3;
/** Distribución de las notificaciones de la industria que se informa. */
const MAX_NOTIFIED_SUMMARY = 5;

/**
 * ECHA CHEM (Agencia Europea de Sustancias y Mezclas Químicas) — API JSON de su portal.
 * Es la fuente de referencia para clasificar: la clasificación ARMONIZADA del Anexo VI del CLP con
 * sus límites de concentración específicos, factores M y ETA (lo que necesita el cálculo de la mezcla),
 * más la clasificación dominante notificada por la industria (C&L Inventory).
 *
 * Términos de ECHA: se permite la consulta puntual (una sustancia a la vez, bajo demanda) citando la
 * fuente; NO la extracción masiva. Por eso: cache largo, pocas consultas simultáneas y la cita en
 * cada respuesta (`meta.attribution`).
 */
@Injectable()
export class EchaSourceProvider extends BaseSourceProvider {
  readonly code = SourceCodeEnum.ECHA;
  readonly cacheTtlDays = 30;
  readonly info: SourceInfo = {
    name: 'ECHA CHEM — C&L Inventory',
    owner: 'Agencia Europea de Sustancias y Mezclas Químicas (ECHA)',
    kind: SourceKindEnum.API_JSON,
    homepage: 'https://chem.echa.europa.eu',
    sdsSections: [2, 3, 11, 12, 15],
    description:
      'Clasificación armonizada CLP (Anexo VI) con límites de concentración específicos, factores M y ETA; clasificación notificada dominante.',
  };

  constructor(private readonly http: ExternalHttpClient) {
    super();
  }

  protected override resilience(): Partial<ResilienceOptions> {
    return { timeoutMs: 20_000, maxAttempts: 3, maxConcurrent: 2 };
  }

  protected async performFetch(cas: string, signal: AbortSignal): Promise<SourceFetchOutput> {
    const search = await this.json<EchaSearchResponse>(
      `${ECHA_BASE_URL}/api-substance/v1/substance?pageIndex=1&pageSize=20&searchText=${encodeURIComponent(cas)}`,
      signal,
    );
    const substance = EchaParser.pickSubstance(search, cas);
    if (!substance) throw new SubstanceNotFoundInSourceError(this.code, cas);

    const sourceUrl = EchaParser.substanceUrl(substance.rmlId);
    const [harmonisedList, notifiedList] = await Promise.all([
      this.json<EchaClassificationListResponse>(`${API}/harmonized/${substance.rmlId}/classifications`, signal),
      this.json<EchaClassificationListResponse>(`${API}/industry/${substance.rmlId}/classifications`, signal),
    ]);

    const harmonisedEntries = EchaParser.sortHarmonised(harmonisedList).slice(0, MAX_HARMONISED);
    const harmonisedParts = await Promise.all(harmonisedEntries.map((entry) => this.fetchHarmonised(entry, signal)));
    const harmonised = harmonisedParts.map((parts) => EchaParser.parseHarmonised(parts));

    const notified = EchaParser.sortNotified(notifiedList);
    const dominant = notified[0];
    const [dominantClasses, dominantPictograms] = dominant
      ? await Promise.all([
          this.json<EchaClassificationResponse>(`${API}/industry/classification/${dominant.classificationId}`, signal),
          this.json<EchaPictogramsResponse>(`${API}/industry/pictograms/${dominant.classificationId}`, signal),
        ])
      : [{}, {}];

    const records: SourceRecord[] = [
      { field: 'identity.name', label: 'Name', value: substance.rmlName, sourceUrl },
      { field: 'identity.iupacName', label: 'IUPAC name', value: substance.rmlIupac, sourceUrl },
      { field: 'identity.ecNumber', label: 'EC number', value: substance.rmlEc, sourceUrl },
      { field: 'identity.indexNumber', label: 'CLP Index number', value: substance.indexNumber?.[0], sourceUrl },
      { field: 'identity.echaRmlId', label: 'ECHA substance id', value: substance.rmlId, sourceUrl },
      {
        field: 'regulatory.echaProcesses',
        label: 'Regulatory processes',
        value: substance.regulatoryProcesses ?? [],
        sourceUrl,
      },
      { field: 'ghs.harmonised', label: 'Harmonised classification (CLP Annex VI)', value: harmonised, sourceUrl },
      {
        field: 'ghs.notified',
        label: 'Notified classification (C&L Inventory)',
        value: dominant
          ? {
              totalClassifications: notified.length,
              dominant: {
                notificationPercentage: dominant.substanceNotificationPercentage,
                dataSource: dominant.dataSource,
                hazardClasses: EchaParser.parseHazardClasses(dominantClasses),
                pictograms: EchaParser.parsePictograms(dominantPictograms),
              },
              distribution: notified.slice(0, MAX_NOTIFIED_SUMMARY).map((n) => ({
                notificationPercentage: n.substanceNotificationPercentage,
                dataSource: n.dataSource,
              })),
            }
          : null,
        sourceUrl,
      },
      { field: 'meta.attribution', label: 'Attribution', value: ECHA_ATTRIBUTION, sourceUrl },
    ].filter((record) => record.value !== undefined && record.value !== null);

    return {
      records,
      sourceUrl,
      raw: {
        url: sourceUrl,
        contentType: 'application/json',
        content: JSON.stringify({
          substance,
          harmonisedList,
          harmonisedParts,
          notifiedList,
          dominantClasses,
          dominantPictograms,
        }),
      },
    };
  }

  private async fetchHarmonised(
    entry: NonNullable<EchaClassificationListResponse['items']>[number],
    signal: AbortSignal,
  ) {
    const id = entry.classificationId;
    const [
      classification,
      labelling,
      pictograms,
      specificConcentrationLimits,
      mFactorsRaw,
      acuteToxicityEstimates,
      notes,
    ] = await Promise.all([
      this.json<EchaClassificationResponse>(`${API}/harmonized/classification/${id}`, signal),
      this.json<EchaLabellingResponse>(`${API}/harmonized/labelling/${id}`, signal),
      this.json<EchaPictogramsResponse>(`${API}/harmonized/pictograms/${id}`, signal),
      this.json<EchaScl>(`${API}/harmonized/specific-concentration-limits/${id}`, signal),
      this.http.getText(`${API}/harmonized/m-factors/${id}`, signal, 'application/json'),
      this.json<EchaAteResponse>(`${API}/harmonized/acute-toxicity-estimates/${id}`, signal),
      this.json<EchaNotesResponse>(`${API}/harmonized/notes/${id}`, signal),
    ]);
    return {
      entry,
      classification,
      labelling,
      pictograms,
      specificConcentrationLimits,
      mFactors: EchaParser.parseMFactors(mFactorsRaw.raw),
      acuteToxicityEstimates,
      notes,
    };
  }

  private async json<T>(url: string, signal: AbortSignal): Promise<T> {
    return (await this.http.getJson<T>(url, signal)).body;
  }
}

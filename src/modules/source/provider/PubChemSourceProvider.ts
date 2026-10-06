import { Injectable } from '@nestjs/common';
import { ExternalHttpClient, ExternalHttpError } from '@/shared/http';
import { ResilienceOptions } from '@/shared/resilience';
import { BaseSourceProvider, SourceFetchOutput } from '@/modules/source/base';
import { SourceInfo, SourceRecord } from '@/modules/source/dto';
import { SourceCodeEnum, SourceKindEnum } from '@/modules/source/enums';
import { SubstanceNotFoundInSourceError } from '@/modules/source/exception';
import {
  PubChemGhsResponse,
  PubChemParser,
  PubChemPropertiesResponse,
  PubChemSynonymsResponse,
  PubChemViewParser,
  PubChemViewResponse,
  PUBCHEM_VIEW_HEADINGS,
} from '@/modules/source/parser';

const API = 'https://pubchem.ncbi.nlm.nih.gov/rest';
const PROPERTIES = 'Title,IUPACName,MolecularFormula,MolecularWeight,InChIKey,SMILES';
/** Candidatos a revisar cuando un CAS devuelve varios CIDs. */
const MAX_CID_CANDIDATES = 3;

/**
 * PubChem (NIH) — fuente JSON vía API oficial PUG-REST + PUG-View.
 *  1. CAS → CID (`/compound/name/{cas}/cids`). Si hay varios, se elige el que tiene el CAS en sus sinónimos.
 *  2. Sinónimos (confirman el CAS) + propiedades + clasificación SGA, en paralelo.
 *  3. Registro completo (PUG-View) por bloques: propiedades experimentales, seguridad y peligros, y
 *     toxicidad/ecología. Es donde PubChem agrega HSDB, CAMEO, Haz-Map, EPA… (eliminación, ecotoxicidad,
 *     biodegradación, designación de transporte, LD50, tratamiento médico).
 * Límite de la API: 5 req/s por IP → bulkhead de 2 consultas a la vez (cada una hace ~7 requests).
 */
@Injectable()
export class PubChemSourceProvider extends BaseSourceProvider {
  readonly code = SourceCodeEnum.PUBCHEM;
  readonly info: SourceInfo = {
    name: 'PubChem',
    owner: 'National Institutes of Health (NIH, EE. UU.)',
    kind: SourceKindEnum.API_JSON,
    homepage: 'https://pubchem.ncbi.nlm.nih.gov',
    sdsSections: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    description:
      'Identidad, clasificaciones SGA y el registro completo que agrega HSDB, CAMEO, Haz-Map y EPA: propiedades experimentales, primeros auxilios, incendio, vertidos, eliminación, reactividad, toxicidad, ecotoxicidad y transporte.',
  };
  readonly cacheTtlDays = 30;
  /** Desde aquí se lee también el registro completo (PUG-View): lo consultado antes se vuelve a pedir. */
  override readonly extractionUpdatedAt = new Date('2026-10-02T20:30:00Z');

  constructor(private readonly http: ExternalHttpClient) {
    super();
  }

  protected override resilience(): Partial<ResilienceOptions> {
    // El registro completo pesa varios MB: más tiempo que una consulta puntual.
    return { timeoutMs: 25_000, maxAttempts: 3, maxConcurrent: 2 };
  }

  protected async performFetch(cas: string, signal: AbortSignal): Promise<SourceFetchOutput> {
    const cids = await this.findCids(cas, signal);

    // Caso normal (un CID que confirma el CAS): sinónimos, propiedades y SGA en paralelo → 2 etapas, no 3.
    let cid = cids[0];
    let [synonyms, properties, ghs] = await Promise.all([
      this.getSynonyms(cid, signal),
      this.getProperties(cid, signal),
      this.getGhs(cid, signal),
    ]);

    // Si el primer CID no tiene el CAS entre sus sinónimos, se prueba con los siguientes candidatos.
    if (!PubChemParser.isCasInSynonyms(synonyms, cas)) {
      const verified = await this.findVerifiedCid(cids.slice(1, MAX_CID_CANDIDATES), cas, signal);
      if (verified) {
        cid = verified.cid;
        synonyms = verified.synonyms;
        [properties, ghs] = await Promise.all([this.getProperties(cid, signal), this.getGhs(cid, signal)]);
      }
      // Si ninguno lo confirma, se usa el primero y identity.casVerified queda en false.
    }

    const sourceUrl = PubChemParser.compoundUrl(cid);
    const view = await this.getView(cid, signal);
    const records: SourceRecord[] = [
      ...PubChemParser.parseIdentity(properties, synonyms, cas, sourceUrl),
      {
        field: 'ghs.classifications',
        label: 'GHS Classification',
        value: PubChemParser.parseGhsClassifications(ghs),
        sourceUrl: `${sourceUrl}#section=GHS-Classification`,
      },
      ...PubChemViewParser.parse(view, sourceUrl),
    ];

    return {
      records,
      sourceUrl,
      raw: {
        url: sourceUrl,
        contentType: 'application/json',
        // Identidad y SGA completos (se pueden re-parsear sin volver a llamar). El registro completo pesa
        // varios MB por sustancia: de él solo se guarda lo ya extraído, no la respuesta cruda.
        content: JSON.stringify({ cids, properties, synonyms, ghs }),
      },
    };
  }

  private async findCids(cas: string, signal: AbortSignal): Promise<number[]> {
    try {
      const response = await this.http.getJson<{ IdentifierList?: { CID?: number[] } }>(
        `${API}/pug/compound/name/${encodeURIComponent(cas)}/cids/JSON`,
        signal,
      );
      const cids = response.body.IdentifierList?.CID ?? [];
      if (!cids.length) throw new SubstanceNotFoundInSourceError(this.code, cas);
      return cids;
    } catch (error) {
      if (error instanceof ExternalHttpError && error.status === 404) {
        throw new SubstanceNotFoundInSourceError(this.code, cas);
      }
      throw error;
    }
  }

  private async findVerifiedCid(
    candidates: number[],
    cas: string,
    signal: AbortSignal,
  ): Promise<{ cid: number; synonyms: PubChemSynonymsResponse } | undefined> {
    for (const cid of candidates) {
      const synonyms = await this.getSynonyms(cid, signal);
      if (PubChemParser.isCasInSynonyms(synonyms, cas)) return { cid, synonyms };
    }
    return undefined;
  }

  private async getSynonyms(cid: number, signal: AbortSignal): Promise<PubChemSynonymsResponse> {
    return (await this.http.getJson<PubChemSynonymsResponse>(`${API}/pug/compound/cid/${cid}/synonyms/JSON`, signal))
      .body;
  }

  private async getProperties(cid: number, signal: AbortSignal): Promise<PubChemPropertiesResponse> {
    const url = `${API}/pug/compound/cid/${cid}/property/${PROPERTIES}/JSON`;
    return (await this.http.getJson<PubChemPropertiesResponse>(url, signal)).body;
  }

  /** No todas las sustancias tienen sección SGA: un 404 aquí significa "sin clasificación", no error. */
  private async getGhs(cid: number, signal: AbortSignal): Promise<PubChemGhsResponse> {
    try {
      const response = await this.http.getJson<PubChemGhsResponse>(
        `${API}/pug_view/data/compound/${cid}/JSON?heading=${encodeURIComponent('GHS Classification')}`,
        signal,
      );
      return response.body;
    } catch (error) {
      if (error instanceof ExternalHttpError && error.status === 404) return {};
      throw error;
    }
  }

  /**
   * Registro completo, un bloque por request y de a uno (límite de 5 req/s). Un bloque que falla o no
   * existe no tumba la consulta: la identidad y la clasificación SGA ya están.
   */
  private async getView(cid: number, signal: AbortSignal): Promise<PubChemViewResponse[]> {
    const responses: PubChemViewResponse[] = [];
    for (const heading of PUBCHEM_VIEW_HEADINGS) {
      try {
        const url = `${API}/pug_view/data/compound/${cid}/JSON?heading=${encodeURIComponent(heading)}`;
        responses.push((await this.http.getJson<PubChemViewResponse>(url, signal)).body);
      } catch (error) {
        if (error instanceof ExternalHttpError && [400, 404].includes(error.status ?? 0)) continue;
        this.logger.warn(`PubChem: no se pudo leer "${heading}" del CID ${cid}: ${String(error)}`);
      }
    }
    return responses;
  }
}

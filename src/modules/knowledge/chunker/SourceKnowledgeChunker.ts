import { contentHash } from '@/shared/util';
import { SourceRecord } from '@/modules/source';
import { SdsSectionCatalog } from '@/modules/knowledge/catalog/SdsSectionCatalog';

export interface KnowledgeChunkDraft {
  chunkKey: string;
  title: string;
  content: string;
  sdsSections: number[];
  language: string;
  sourceUrl?: string;
  contentHash: string;
}

export interface ChunkerInput {
  cas: string;
  substanceName: string | null;
  source: string;
  records: SourceRecord[];
}

/** Tamaño máximo de un fragmento (caracteres). Más largo → se parte: embeddings más precisos. */
const MAX_CHUNK_CHARS = 2500;
/** Fuentes en español (el resto viene en inglés). */
const SPANISH_SOURCES = new Set(['ICSC', 'INSST_LEP']);
/** Prefijos que se agrupan por CAMPO completo (cada uno es un tema grande en sí mismo). */
const SPLIT_BY_FIELD = new Set(['ghs', 'toxicology', 'carcinogenicity', 'ecology']);

const TOPIC_TITLES: Record<string, string> = {
  identity: 'Identificación',
  ghs: 'Clasificación SGA',
  hazard: 'Peligros',
  firstAid: 'Primeros auxilios',
  fire: 'Incendio y extinción',
  spill: 'Derrames y fugas',
  storage: 'Almacenamiento',
  exposure: 'Exposición y límites',
  protection: 'Protección personal',
  physical: 'Propiedades físicas y químicas',
  thermo: 'Datos termodinámicos',
  reactivity: 'Reactividad',
  health: 'Efectos sobre la salud',
  toxicology: 'Toxicología',
  carcinogenicity: 'Carcinogenicidad',
  ecology: 'Medio ambiente',
  disposal: 'Eliminación',
  transport: 'Transporte',
  regulatory: 'Reglamentación',
  notes: 'Notas',
};

/**
 * Convierte los datos normalizados de UNA fuente para UN CAS en fragmentos de texto para el RAG
 * (función pura). Cada fragmento:
 *  - agrupa los datos de un mismo tema (o un campo, si es grande: ghs.harmonised, toxicology.acute…),
 *  - se etiqueta con las secciones de la FDS que alimenta,
 *  - lleva en el texto la fuente y la sustancia (el agente cita de dónde sale cada dato),
 *  - tiene clave estable y hash: si no cambió, no se vuelve a vectorizar.
 */
export class SourceKnowledgeChunker {
  static chunk(input: ChunkerInput): KnowledgeChunkDraft[] {
    const meta = new Map(input.records.filter((r) => r.field.startsWith('meta.')).map((r) => [r.field, r.value]));
    const attribution =
      typeof meta.get('meta.attribution') === 'string' ? (meta.get('meta.attribution') as string) : undefined;
    const language =
      typeof meta.get('meta.language') === 'string'
        ? (meta.get('meta.language') as string)
        : SPANISH_SOURCES.has(input.source)
          ? 'es'
          : 'en';

    const groups = new Map<string, SourceRecord[]>();
    for (const record of input.records) {
      if (record.field.startsWith('meta.')) continue;
      const prefix = record.field.split('.')[0];
      const key = SPLIT_BY_FIELD.has(prefix) ? record.field : prefix;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }

    const substance = `${input.substanceName ?? 'Sustancia'} (CAS ${input.cas})`;
    return [...groups.entries()].flatMap(([key, records]) => {
      const prefix = key.split('.')[0];
      const topic = TOPIC_TITLES[prefix] ?? 'Otros datos';
      const title = `${input.source} · ${substance} · ${key === prefix ? topic : `${topic} — ${records[0].label}`}`;
      const sections = [...new Set(records.flatMap((r) => SdsSectionCatalog.sectionsForField(r.field)))].sort(
        (a, b) => a - b,
      );
      const header = [
        `Fuente: ${input.source}${attribution ? ` (${attribution})` : ''}`,
        `Sustancia: ${substance}`,
        `Tema: ${topic}`,
      ];
      const lines = records.map(
        (r) => `- ${r.label}: ${SourceKnowledgeChunker.formatValue(r.value)}${r.unit ? ` ${r.unit}` : ''}`,
      );

      return SourceKnowledgeChunker.split(header, lines).map((body, index, parts) => {
        const content = body;
        return {
          chunkKey: parts.length > 1 ? `${key}#${index + 1}` : key,
          title: parts.length > 1 ? `${title} (${index + 1}/${parts.length})` : title,
          content,
          sdsSections: sections,
          language,
          sourceUrl: records[0].sourceUrl,
          contentHash: contentHash({ content, sections }),
        };
      });
    });
  }

  /** Valor → texto legible y compacto para el modelo (no JSON crudo). */
  static formatValue(value: unknown, depth = 0): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value.toString();
    if (typeof value !== 'object') return '—';
    if (Array.isArray(value)) {
      if (!value.length) return '—';
      if (value.every((v) => typeof v !== 'object')) return value.join('; ');
      return value
        .map((v) => `\n${'  '.repeat(depth + 1)}• ${SourceKnowledgeChunker.formatValue(v, depth + 1)}`)
        .join('');
    }
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length),
    );
    return entries.map(([k, v]) => `${k}: ${SourceKnowledgeChunker.formatValue(v, depth + 1)}`).join(', ');
  }

  /** Parte las líneas en bloques de hasta MAX_CHUNK_CHARS, repitiendo el encabezado en cada bloque. */
  private static split(header: string[], lines: string[]): string[] {
    const head = header.join('\n');
    const parts: string[] = [];
    let current: string[] = [];
    let size = head.length;
    for (const line of lines) {
      const piece = line.length > MAX_CHUNK_CHARS ? `${line.slice(0, MAX_CHUNK_CHARS)}…` : line;
      if (current.length && size + piece.length + 1 > MAX_CHUNK_CHARS) {
        parts.push([head, ...current].join('\n'));
        current = [];
        size = head.length;
      }
      current.push(piece);
      size += piece.length + 1;
    }
    if (current.length) parts.push([head, ...current].join('\n'));
    return parts;
  }
}

import { z } from 'zod';

/**
 * Lo que el agente DEVUELVE por sección: los CAMPOS de la plantilla (SdsSectionCatalog), no texto libre.
 * `value: null` = ninguna fuente tiene ese dato (queda "Sin datos disponibles"). Se valida con Zod y luego
 * ProvenanceValidator verifica las referencias y descarta los valores sin cita.
 */
export const SdsSectionDraftSchema = z.object({
  number: z.number().int().min(1).max(16),
  fields: z.array(
    z.object({
      /** Clave del campo en la plantilla: "inhalation", "flashPoint"… */
      key: z.string(),
      /** Contenido del campo en el idioma pedido, o null si las fuentes no lo tienen. */
      value: z.string().nullable(),
      /** Fragmentos de conocimiento que respaldan el valor: "K3", "K7". Obligatorio si hay valor. */
      sourceRefs: z.array(z.string()),
    }),
  ),
  /** Fuentes que se contradicen: qué se eligió y por qué (criterio conservador). */
  conflicts: z.array(
    z.object({
      field: z.string(),
      chosen: z.string(),
      alternatives: z.array(z.string()),
      reason: z.string(),
    }),
  ),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const SdsSectionDraftBatchSchema = z.object({ sections: z.array(SdsSectionDraftSchema) });

export type SdsSectionDraft = z.infer<typeof SdsSectionDraftSchema>;
export type SdsSectionDraftBatch = z.infer<typeof SdsSectionDraftBatchSchema>;

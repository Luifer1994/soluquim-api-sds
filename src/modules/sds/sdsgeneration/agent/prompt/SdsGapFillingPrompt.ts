/** Subir cada vez que cambia el bloque de búsqueda dirigida (queda en el log y la traza del agente). */
export const GAP_FILLING_PROMPT_VERSION = 'sds-gap-filling.v2';

/** Instrucciones de la 2.ª pasada con búsqueda: se suman al prompt de revisión de campos vacíos. */
export const GAP_SEARCH_BLOCK = `

BÚSQUEDA DIRIGIDA — además de los fragmentos que ya tienes, puedes buscar en las fuentes:
- search_sources: datos de cada sustancia (fuentes oficiales por CAS). Consultas precisas por campo vacío: el dato y la sustancia (p. ej. "punto de inflamación acetona", "DL50 oral rata etanol").
- search_reference_docs: lo que la normativa (SGA, GRE, Reglamentación Modelo, procedimientos) establece para este producto (medidas por tipo de peligro, transporte).
- search_product_documents (si hay documentos del producto): las FDS de las materias primas y los datos del producto final.
- Puedes hacer varias búsquedas en el mismo turno. Cada resultado trae su referencia (S…, R… o D…): cítala en sourceRefs igual que las del contexto.
- Si después de buscar ningún fragmento trae el dato, el campo queda en null: las reglas de no inventar siguen intactas.
- Cuando termines, entrega el JSON con final_answer.`;

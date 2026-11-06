import { z, ZodType } from 'zod';

/**
 * Palabras de validación que NO se le envían al modelo: algunos proveedores (Gemini) convierten cada restricción en
 * estados de su gramática y rechazan el schema ("too many states"). El modelo recibe la forma (tipos, campos,
 * enums, requeridos, descripciones); la validación completa la hace Zod al recibir los argumentos, y si algo no
 * cumple el error vuelve al modelo para que corrija.
 */
const VALIDATION_ONLY = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

/** Claves cuyo valor es un mapa de schemas (sus claves son nombres, no palabras de JSON Schema). */
const SCHEMA_MAPS = new Set(['properties', 'definitions', '$defs', 'patternProperties']);

/** JSON Schema de los argumentos de una herramienta, como se le envía al modelo. */
export function toToolParameters(schema: ZodType): Record<string, unknown> {
  return simplify(z.toJSONSchema(schema, { target: 'draft-7' })) as Record<string, unknown>;
}

function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify);
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>)
      .filter(([key]) => !VALIDATION_ONLY.has(key))
      .map(([key, value]) => [
        key,
        SCHEMA_MAPS.has(key) && value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).map(([name, child]) => [name, simplify(child)]),
            )
          : simplify(value),
      ]),
  );
}

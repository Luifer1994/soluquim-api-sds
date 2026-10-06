import { ZodType } from 'zod';

export type ParseResult<T> = { success: true; data: T } | { success: false; error: string };

/** Lee la respuesta JSON de un LLM y la valida contra el schema (función pura). */
export class StructuredOutput {
  static parse<T>(content: string, schema: ZodType<T>): ParseResult<T> {
    // Algunos modelos envuelven el JSON en ```json … ``` aunque se pida JSON puro.
    const json = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch (error) {
      return { success: false, error: `JSON inválido: ${String(error)}` };
    }
    const parsed = schema.safeParse(value);
    return parsed.success
      ? { success: true, data: parsed.data }
      : { success: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n') };
  }
}

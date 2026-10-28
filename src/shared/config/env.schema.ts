import { z } from 'zod';

/**
 * Variables de entorno del servicio. Se validan al arrancar: si falta o sobra algo inválido, el
 * proceso no levanta y el error dice exactamente qué variable corregir.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Qué proceso es este contenedor: la API HTTP o el worker que consume la cola. */
  SDS_PROCESS: z.enum(['api', 'worker']).default('api'),

  // HTTP
  PORT: z.coerce.number().int().positive().default(8084),
  SWAGGER_ENABLED: z.stringbool().default(true),

  // Logs
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z.stringbool().default(false),

  // Base de datos propia (sds-postgres)
  DATABASE_URL: z.url(),

  // RabbitMQ — misma topología que soluquim-commons (CommonsMessagingAutoConfiguration)
  RABBITMQ_URL: z.url(),
  MESSAGING_EXCHANGE: z.string().default('soluquim.tasks'),
  MESSAGING_QUEUE: z.string().default('soluquim.sds.tasks.q'),
  MESSAGING_BINDING_PATTERN: z.string().default('sds.#'),
  MESSAGING_DEAD_LETTER_EXCHANGE: z.string().default('soluquim.tasks.dlx'),
  MESSAGING_DEAD_LETTER_QUEUE: z.string().default('soluquim.tasks.dlq'),
  MESSAGING_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  MESSAGING_INITIAL_BACKOFF_MS: z.coerce.number().int().min(0).default(2000),
  MESSAGING_BACKOFF_MULTIPLIER: z.coerce.number().min(1).default(2),
  MESSAGING_MAX_BACKOFF_MS: z.coerce.number().int().min(0).default(10000),

  // Datos y arranque — vienen del .env RAÍZ de soluquim-docker (misma semántica que en los micros Java)
  /** Siembra los catálogos que el servicio necesita para funcionar. Idempotente. */
  APP_SEED_ENABLED: z.stringbool().default(false),
  /** Siembra datos de demostración. Independiente de APP_SEED_ENABLED. */
  APP_SEED_DEMO: z.stringbool().default(false),

  // Fuentes de datos
  /** Códigos de las fuentes activas separados por coma (p. ej. "PUBCHEM,NIOSH_NPG"), o "*" para todas. */
  SOURCES_ENABLED: z.string().default('*'),

  // IA — vienen del .env RAÍZ de soluquim-docker (bloque "IA compartida"): los mismos proveedor y
  // modelos para todos los microservicios. Sin clave, el servicio funciona pero no vectoriza ni redacta.
  /** Proveedor de IA (ver shared/ai/factory/AiProviderFactory). */
  AI_PROVIDER: z.string().default('openrouter'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.url().default('https://openrouter.ai/api/v1'),
  /** Modelo por defecto de los agentes. */
  AI_LLM_MODEL: z.string().min(1).default('google/gemini-2.5-flash'),
  AI_EMBEDDING_MODEL: z.string().min(1).default('openai/text-embedding-3-small'),
  /** DEBE coincidir con la columna vector(N) de knowledge_chunks. */
  AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  /** Modelo por agente, si alguno usa otro: "agente=modelo,agente2=modelo2". */
  AI_AGENT_MODELS: z.string().default(''),
  // Ajustes propios de este servicio (soluquim-api-sds/.env)
  AI_LLM_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.2),
  AI_LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8000),
  /**
   * Tamaño máximo (caracteres) del contexto del RAG que recibe el agente en CADA llamada (~4 caracteres
   * por token). Más alto = más contexto y más costo. Se reparte entre los componentes de la mezcla.
   */
  AI_CONTEXT_MAX_CHARS: z.coerce.number().int().min(2000).default(60000),
  /**
   * Caracteres máximos de DOCUMENTACIÓN DE REFERENCIA (SGA, GRE, procedimientos…) que recibe el agente en cada
   * llamada, además del contexto por CAS. Más alto = más criterio y más costo.
   */
  AI_REFERENCE_CONTEXT_MAX_CHARS: z.coerce.number().int().min(0).default(16000),
  /**
   * Caracteres máximos de DOCUMENTOS DEL PRODUCTO (FDS de las materias primas y de análogos, datos del producto
   * final, adjuntos a la generación) que recibe el agente por cada grupo de secciones.
   */
  AI_PRODUCT_DOCUMENTS_CONTEXT_MAX_CHARS: z.coerce.number().int().min(0).default(24000),
  /**
   * Redacción por etapas (orden del procedimiento TR-P-01, Anexo 1): primero clasificación, propiedades y
   * toxicología; después emergencias, protección, eliminación y transporte, con lo ya redactado como contexto
   * para que la ficha sea coherente. Tarda más (dos rondas de llamadas). false = todo en paralelo.
   */
  AI_STAGED_DRAFTING: z.stringbool().default(true),
  /** Llamadas simultáneas al LLM por proceso (una FDS hace ~6). */
  AI_LLM_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(3),

  // Documentación de referencia
  /** Tamaño máximo de un documento subido (MB). */
  REFERENCE_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(50),

  // Worker
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(2),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Configuración inválida. Revisa las variables de entorno:\n${details}`);
  }
  return parsed.data;
}

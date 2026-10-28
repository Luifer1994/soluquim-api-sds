import { Env } from '@/shared/config/env.schema';

export interface AiConfig {
  provider: string;
  apiKey?: string;
  baseUrl: string;
  llm: { model: string; temperature: number; maxOutputTokens: number; maxConcurrency: number };
  /** Caracteres máximos de contexto del RAG por llamada al agente. */
  contextMaxChars: number;
  /** Caracteres máximos de documentación de referencia por llamada al agente. */
  referenceContextMaxChars: number;
  /** Caracteres máximos de documentos del producto por llamada al agente. */
  productDocumentsContextMaxChars: number;
  /** Redacción por etapas (coherencia entre secciones). */
  stagedDrafting: boolean;
  /** Modelo por agente (nombre del agente → modelo). Si no está, LLM_MODEL. */
  agentModels: ReadonlyMap<string, string>;
  embedding: { model: string; dimensions: number };
}

export interface MessagingConfig {
  url: string;
  exchange: string;
  queue: string;
  bindingPattern: string;
  deadLetterExchange: string;
  deadLetterQueue: string;
  maxAttempts: number;
  initialBackoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
  /** Mensajes en vuelo por proceso worker (prefetch). Un job de FDS tarda minutos: mantenerlo bajo. */
  concurrency: number;
}

/** Configuración tipada del servicio. Se inyecta; nadie lee `process.env` fuera de este módulo. */
export class AppConfig {
  readonly nodeEnv: Env['NODE_ENV'];
  readonly process: Env['SDS_PROCESS'];
  readonly isProduction: boolean;
  readonly port: number;
  readonly swaggerEnabled: boolean;
  readonly log: { level: Env['LOG_LEVEL']; pretty: boolean };
  readonly databaseUrl: string;
  readonly messaging: MessagingConfig;
  readonly seed: { catalogs: boolean; demo: boolean };
  /** Fuentes activas: `'*'` = todas, o la lista de códigos. */
  readonly sourcesEnabled: '*' | ReadonlySet<string>;
  readonly ai: AiConfig;
  readonly reference: { maxUploadBytes: number };

  constructor(env: Env) {
    this.nodeEnv = env.NODE_ENV;
    this.process = env.SDS_PROCESS;
    this.isProduction = env.NODE_ENV === 'production';
    this.port = env.PORT;
    this.swaggerEnabled = env.SWAGGER_ENABLED;
    this.log = { level: env.LOG_LEVEL, pretty: env.LOG_PRETTY };
    this.databaseUrl = env.DATABASE_URL;
    this.seed = { catalogs: env.APP_SEED_ENABLED, demo: env.APP_SEED_DEMO };
    const sources = env.SOURCES_ENABLED.split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    this.sourcesEnabled = sources.includes('*') || !sources.length ? '*' : new Set(sources);
    this.ai = {
      provider: env.AI_PROVIDER.trim().toLowerCase(),
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL,
      llm: {
        model: env.AI_LLM_MODEL,
        temperature: env.AI_LLM_TEMPERATURE,
        maxOutputTokens: env.AI_LLM_MAX_OUTPUT_TOKENS,
        maxConcurrency: env.AI_LLM_MAX_CONCURRENCY,
      },
      contextMaxChars: env.AI_CONTEXT_MAX_CHARS,
      referenceContextMaxChars: env.AI_REFERENCE_CONTEXT_MAX_CHARS,
      productDocumentsContextMaxChars: env.AI_PRODUCT_DOCUMENTS_CONTEXT_MAX_CHARS,
      stagedDrafting: env.AI_STAGED_DRAFTING,
      agentModels: new Map(
        env.AI_AGENT_MODELS.split(',')
          .map((pair) => pair.split('=').map((part) => part.trim()))
          .filter((pair): pair is [string, string] => pair.length === 2 && Boolean(pair[0]) && Boolean(pair[1])),
      ),
      embedding: { model: env.AI_EMBEDDING_MODEL, dimensions: env.AI_EMBEDDING_DIMENSIONS },
    };
    this.reference = { maxUploadBytes: env.REFERENCE_MAX_UPLOAD_MB * 1024 * 1024 };
    this.messaging = {
      url: env.RABBITMQ_URL,
      exchange: env.MESSAGING_EXCHANGE,
      queue: env.MESSAGING_QUEUE,
      bindingPattern: env.MESSAGING_BINDING_PATTERN,
      deadLetterExchange: env.MESSAGING_DEAD_LETTER_EXCHANGE,
      deadLetterQueue: env.MESSAGING_DEAD_LETTER_QUEUE,
      maxAttempts: env.MESSAGING_MAX_ATTEMPTS,
      initialBackoffMs: env.MESSAGING_INITIAL_BACKOFF_MS,
      backoffMultiplier: env.MESSAGING_BACKOFF_MULTIPLIER,
      maxBackoffMs: env.MESSAGING_MAX_BACKOFF_MS,
      concurrency: env.WORKER_CONCURRENCY,
    };
  }
}

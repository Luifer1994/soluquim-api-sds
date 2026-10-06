export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  /** Costo en USD, si el proveedor lo informa. */
  cost?: number;
}

export interface LlmRequest {
  model: string;
  messages: ChatMessage[];
  /** JSON Schema de la respuesta esperada (salida estructurada). */
  jsonSchema?: Record<string, unknown>;
  schemaName?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmResponse {
  content: string;
  /** Modelo que efectivamente respondió (el proveedor puede enrutar a una variante). */
  model: string;
  usage: LlmUsage;
}

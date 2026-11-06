export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** Herramienta que el modelo pidió ejecutar. `arguments` es el JSON tal cual lo escribió el modelo (se valida antes de usarlo). */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Mensaje del asistente: herramientas que pidió en ese turno. */
  toolCalls?: ToolCall[];
  /** Mensaje de herramienta: a qué llamada responde. */
  toolCallId?: string;
}

/** Herramienta que se le ofrece al modelo: nombre, para qué sirve y el JSON Schema de sus argumentos. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** `auto`: el modelo decide; `required`: debe llamar alguna; `none`: no puede llamar ninguna. */
export type ToolChoice = 'auto' | 'required' | 'none';

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
  /** Herramientas disponibles en esta llamada (sin ellas, el modelo solo responde texto). */
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
}

export interface LlmResponse {
  content: string;
  /** Modelo que efectivamente respondió (el proveedor puede enrutar a una variante). */
  model: string;
  usage: LlmUsage;
  /** Herramientas que el modelo pidió ejecutar (vacío o ausente si respondió directo). */
  toolCalls?: ToolCall[];
}

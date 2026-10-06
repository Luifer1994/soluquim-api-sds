/** Contrato de un proveedor de embeddings (vectores para la búsqueda semántica del RAG). */
export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  /** Dimensión de los vectores. DEBE coincidir con la columna vector(N) de la BD. */
  readonly dimensions: number;
  /** Un vector por texto, en el mismo orden. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Token de inyección: `@Inject(EMBEDDING_PROVIDER) embeddings: EmbeddingProvider`. */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

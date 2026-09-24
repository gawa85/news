/**
 * Abstracción de "un modelo de lenguaje que devuelve JSON".
 * Los adaptadores con IA dependen de esta interfaz, no de un proveedor concreto:
 * cambiar de proveedor o de modelo = escribir otro ILLMClient.
 */
export interface LLMRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface LLMUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ILLMClient {
  completeJSON<T>(request: LLMRequest): Promise<{ data: T; usage?: LLMUsage }>;
}

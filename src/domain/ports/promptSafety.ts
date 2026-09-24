import type { InjectionSignal } from "../model";

/** Busca instrucciones escondidas en un texto (reglas, IA, un servicio externo…). */
export interface IPromptInjectionDetector {
  readonly id: string;
  inspect(text: string): Promise<InjectionSignal[]>;
}

/** Deja el texto apto para mandarlo a la IA: sin caracteres invisibles. */
export interface ITextSanitizer {
  sanitize(text: string): {
    text: string;
    /** Cuántos caracteres invisibles se sacaron. */
    removed: number;
    /** Texto que estaba escondido (p. ej. codificado en etiquetas Unicode), para inspeccionarlo. */
    hidden: string;
  };
}

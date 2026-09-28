import type { DetectedLanguage, LanguageCode } from "../model";

/** En qué idioma está un texto (por palabras frecuentes, un servicio, un modelo…). */
export interface ILanguageDetector {
  detect(text: string): Promise<DetectedLanguage>;
}

/**
 * Traducción automática (DeepL, Google, un modelo de IA…). Recibe varios textos juntos
 * (una sola llamada por respuesta) y devuelve las traducciones en el mismo orden.
 */
export interface ITranslator {
  readonly id: string;
  translate(texts: string[], to: LanguageCode, from?: LanguageCode): Promise<string[]>;
}

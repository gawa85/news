/**
 * IDIOMAS: la persona elige en qué idioma le responde Sin Humo, y las fuentes en otros
 * idiomas se traducen para poder compararlas con las locales.
 */

/** Código ISO 639-1 ("es", "pt", "en"). */
export type LanguageCode = string;

export interface DetectedLanguage {
  language: LanguageCode;
  /** 0-1: qué tan seguro es (en textos cortos, poco). */
  confidence: number;
}

export interface SupportedLanguage {
  code: LanguageCode;
  /** Nombre en su propio idioma ("Português"). */
  name: string;
  /** Variante regional para voces y formatos ("pt-BR"). */
  locale: string;
}

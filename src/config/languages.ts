/**
 * IDIOMAS. Son DATOS: sumar uno = agregarlo acá (y que el traductor lo soporte).
 * El producto está escrito en castellano; los demás idiomas se sirven traduciendo.
 */
import type { SupportedLanguage } from "../domain/model";

/** El idioma en que está escrito el producto (y al que se traducen las fuentes para compararlas). */
export const BASE_LANGUAGE = "es";

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "es", name: "Español", locale: "es-AR" },
  { code: "pt", name: "Português", locale: "pt-BR" },
  { code: "en", name: "English", locale: "en-US" },
];

/** Por debajo de esto, la detección no alcanza para decidir nada (se asume castellano). */
export const MIN_DETECTION_CONFIDENCE = 0.5;

/**
 * Comandos en otros idiomas → su nombre en castellano (el intérprete trabaja en castellano).
 * También valen sin barra las palabras de BAJA/ALTA (las maneja el caso de uso).
 */
export const COMMAND_ALIASES: Record<string, Record<string, string>> = {
  pt: {
    ajuda: "ayuda", comparar: "comparar", credibilidade: "credibilidad", excluir: "excluir", seguir: "seguir", deixar: "dejar",
    temas: "temas", formato: "formato", audio: "audio", áudio: "audio", silencio: "silencio", silêncio: "silencio", preferencias: "preferencias",
    preferências: "preferencias", jogar: "jugar", progresso: "progreso", convidar: "invitar", codigo: "codigo", código: "codigo", suporte: "soporte",
    resumo: "resumen", guardar: "guardar", arquivar: "guardar", plano: "plan", regras: "reglas", idioma: "idioma", lingua: "idioma", língua: "idioma",
  },
  en: {
    help: "ayuda", compare: "comparar", credibility: "credibilidad", exclude: "excluir", follow: "seguir", unfollow: "dejar", topics: "temas",
    format: "formato", audio: "audio", quiet: "silencio", preferences: "preferencias", settings: "preferencias", play: "jugar", progress: "progreso",
    invite: "invitar", code: "codigo", support: "soporte", tickets: "tickets", digest: "resumen", summary: "resumen", save: "guardar", archive: "guardar",
    plan: "plan", rules: "reglas", language: "idioma",
  },
};

/** Valores de algunos comandos ("/formato curto", "/digest weekly") → en castellano. */
export const VALUE_ALIASES: Record<string, string> = {
  curto: "corto", detalhado: "detallado", fácil: "fácil", facil: "fácil", sim: "si", não: "no", nao: "no", diário: "diario", diario: "diario", semanal: "semanal",
  short: "corto", detailed: "detallado", easy: "fácil", yes: "si", daily: "diario", weekly: "semanal", off: "no", follow: "seguir", watch: "seguir",
};

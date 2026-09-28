/**
 * DETECCIÓN DE IDIOMA por palabras frecuentes (regla pura: sin red ni costo).
 * Alcanza para castellano, portugués e inglés en mensajes y notas; en textos muy cortos
 * la confianza es baja y quien la usa no debería decidir nada con eso.
 */
import type { DetectedLanguage } from "../model";

/** Palabras muy frecuentes y propias de cada idioma (las compartidas, como "que" o "no", no suman). */
const WORDS: Record<string, string[]> = {
  es: ["el", "la", "los", "las", "del", "y", "es", "está", "están", "una", "con", "por", "pero", "muy", "más", "fue", "son", "hay", "también", "ya", "sus", "este", "esta", "esto", "ese", "eso", "cuando", "donde", "desde", "hasta", "mañana", "gobierno", "según", "dijo", "nos", "le", "les", "lo", "sin", "todos", "hoy", "ayer", "año", "años"],
  // Sin "o" ni "no" (en castellano son "o" y la negación: confundirían).
  pt: ["os", "as", "do", "da", "dos", "das", "e", "é", "está", "estão", "um", "uma", "com", "não", "mas", "muito", "mais", "foi", "são", "há", "também", "já", "seu", "sua", "isso", "este", "esta", "quando", "onde", "desde", "até", "amanhã", "governo", "segundo", "disse", "nós", "você", "vocês", "ele", "ela", "sem", "todos", "hoje", "ontem", "ano", "anos", "pelo", "pela", "ao", "aos", "na", "nas", "nos"],
  // Sin "a" (en castellano y portugués es una preposición muy común).
  en: ["the", "of", "and", "is", "are", "was", "were", "an", "with", "for", "but", "very", "more", "has", "have", "had", "also", "already", "his", "her", "their", "this", "that", "these", "when", "where", "since", "until", "tomorrow", "government", "according", "said", "we", "you", "it", "without", "all", "today", "yesterday", "year", "years", "to", "in", "on", "by", "from", "not"],
};

/** Letras propias: pesan más que una palabra. */
const LETTERS: Record<string, RegExp> = { es: /[ñ¿¡]/g, pt: /[ãõç]|ção|ções/g, en: /\b(?:th|wh)\w+/g };

const LOOKUP = new Map<string, string[]>();
for (const [lang, words] of Object.entries(WORDS)) for (const w of words) LOOKUP.set(w, [...(LOOKUP.get(w) ?? []), lang]);

export function detectLanguage(text: string, fallback = "es"): DetectedLanguage {
  const clean = text.toLowerCase().replace(/https?:\/\/\S+/g, " ");
  const tokens = clean.match(/[a-záéíóúñãõâêôàçü]+/g) ?? [];
  const score: Record<string, number> = { es: 0, pt: 0, en: 0 };
  for (const t of tokens) {
    const langs = LOOKUP.get(t);
    // Una palabra de un solo idioma suma 1; si la comparten, suma menos a cada uno.
    if (langs) for (const l of langs) score[l]! += 1 / langs.length;
  }
  for (const [lang, re] of Object.entries(LETTERS)) score[lang]! += (clean.match(re) ?? []).length * (lang === "en" ? 0.3 : 2);
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked as [[string, number], [string, number]];
  if (best[1] < 1) return { language: fallback, confidence: 0 };
  // Confianza: cuánto le saca al segundo y cuánta evidencia hay (textos cortos, poca).
  const margin = (best[1] - second[1]) / best[1];
  const evidence = Math.min(1, best[1] / 6);
  return { language: best[0], confidence: Math.round(margin * evidence * 100) / 100 };
}

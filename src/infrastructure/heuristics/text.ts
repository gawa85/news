/** Utilidades de texto compartidas por los adaptadores basados en reglas. */

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const STOPWORDS = new Set(
  "el la los las un una unos unas de del al a en y o u que se su sus por para con sin es son fue ser lo le les como mas pero este esta estos estas ese esa eso ya muy tambien sobre entre desde hasta segun hay ha han".split(" "),
);

/** Palabras con contenido (sin números ni palabras vacías). Útil para comparar de qué habla un texto. */
export function contentWords(text: string): Set<string> {
  return new Set(
    normalize(text)
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map(stem),
  );
}

/** Stemming mínimo para español (plurales). */
function stem(w: string): string {
  if (w.endsWith("es") && w.length > 5) return w.slice(0, -2);
  if (w.endsWith("s") && w.length > 4) return w.slice(0, -1);
  return w;
}

export function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return matches.map((m) => Number(m.replace(",", ".")));
}

export function findPhrases(text: string, phrases: string[]): string[] {
  const t = normalize(text);
  return phrases.filter((p) => t.includes(normalize(p)));
}

const POSITIVE = ["exito", "logro", "mejora", "alivio", "acierto", "positivo", "necesario", "ordena", "normaliza", "beneficio"];
const NEGATIVE = ["fracaso", "golpe", "ajuste", "castigo", "perjuicio", "negativo", "abusivo", "tarifazo", "impagable", "error"];

/** Polaridad aproximada de -1 (negativa) a +1 (positiva). 0 si no hay señales. */
export function polarity(text: string): number {
  const t = normalize(text);
  const pos = POSITIVE.filter((w) => t.includes(w)).length;
  const neg = NEGATIVE.filter((w) => t.includes(w)).length;
  return pos + neg === 0 ? 0 : (pos - neg) / (pos + neg);
}

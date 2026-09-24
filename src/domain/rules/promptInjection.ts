/**
 * INSTRUCCIONES ESCONDIDAS: reglas puras (sin proveedor) para
 *  1) sacar caracteres invisibles y descubrir texto escondido en Unicode;
 *  2) detectar frases que le hablan a una IA para cambiar su comportamiento;
 *  3) combinar las señales en un puntaje y un riesgo.
 *
 * Criterio: se suma por TIPO de señal (una frase repetida no infla el puntaje) y una
 * sola señal ambigua (p. ej. "decime que es real") no alcanza para el riesgo alto.
 */
import type { InjectionAssessment, InjectionSignal, InjectionSignalType } from "../model";

// ---------------- 1) Caracteres invisibles ----------------

/**
 * Invisibles que no hacen falta en un texto: espacio de ancho cero, unión de palabras,
 * BOM, guion blando, controles bidireccionales. El ZWJ (U+200D) NO está: arma emojis.
 */
const INVISIBLE = /[​⁠﻿­᠎‪-‮⁦-⁩]/g;
/** Etiquetas Unicode (U+E0000…): invisibles, pueden esconder texto ASCII. Tras 🏴 arman banderas. */
const TAG_RUN = /(\u{1F3F4})?([\u{E0000}-\u{E007F}]+)/gu;

export function stripInvisible(text: string): { text: string; removed: number; hidden: string } {
  let removed = 0;
  const hidden: string[] = [];
  const withoutTags = text.replace(TAG_RUN, (all, flag: string | undefined, run: string) => {
    if (flag) return all; // bandera (Inglaterra, Escocia…): legítimo
    const chars = [...run];
    removed += chars.length;
    const decoded = chars.map((c) => c.codePointAt(0)! - 0xe0000).filter((cp) => cp >= 0x20 && cp < 0x7f).map((cp) => String.fromCharCode(cp)).join("");
    if (decoded.trim()) hidden.push(decoded);
    return "";
  });
  const out = withoutTags.replace(INVISIBLE, () => (removed++, ""));
  return { text: out, removed, hidden: hidden.join("\n") };
}

// ---------------- 2) Frases dirigidas a una IA ----------------

interface Pattern {
  type: InjectionSignalType;
  re: RegExp;
  weight: number;
}

const INSTRUCTIONS = "(?:instrucciones|indicaciones|reglas|ordenes|directivas|consignas|instructions|rules|prompts?|guidelines)";
/** Sólo términos inequívocos ("modelo" o "bot" solos son palabras comunes en las noticias). */
const AI = "(?:ia|inteligencia artificial|ai|asistente virtual|assistant|modelo de (?:ia|lenguaje)|language model|chatbot|chatgpt|gpt|claude|gemini|llm|verificador(?:es)? automatico)";

/**
 * Sólo imperativo / infinitivo ("ignorá", "ignorar", "olvidate", "ignore"): el pasado
 * ("el Gobierno ignoró las reglas") es lenguaje de noticias, no una orden.
 */
const OVERRIDE = "(?:ignora|ignorar|ignoralas|ignore|ignoren|olvida|olvidate|olvidar|olvide|olviden|forget|disregard|descarta|descartar|omiti|omitir|override|bypass|saltea|saltear)";
const DETERMINERS = "(?:(?:de|todas?|all|las|los|the|any|of|cualquier)\\s+)*";
/** Lo que deja claro que se habla de las instrucciones DE LA IA. */
const OF_THE_AI_AFTER = "(?:anteriores|previas|previous|prior|above|de arriba|del sistema|de sistema|originales|original|que te dieron|que recibiste)";
const OF_THE_AI_BEFORE = "(?:previous|prior|above|earlier|preceding|system|original|initial)";

const PATTERNS: Pattern[] = [
  // "ignorá todas las instrucciones anteriores", "olvidate de tus reglas", "ignore all previous instructions"
  { type: "override_instructions", weight: 55, re: new RegExp(`\\b${OVERRIDE}\\s+${DETERMINERS}(?:(?:tus|your)\\s+(?:\\w+\\s+)?${INSTRUCTIONS}|${INSTRUCTIONS}\\s+${OF_THE_AI_AFTER}|${OF_THE_AI_BEFORE}\\s+${INSTRUCTIONS})`) },
  { type: "override_instructions", weight: 55, re: new RegExp(`\\b(?:no sigas|dont follow|do not follow|deja de seguir)\\s+(?:(?:tus|your|las|the)\\s+)?${INSTRUCTIONS}`) },
  // Sin nada que lo ate a la IA ("ignorá las reglas"): sospechoso, no concluyente.
  { type: "override_instructions", weight: 30, re: new RegExp(`\\b${OVERRIDE}\\s+${DETERMINERS}${INSTRUCTIONS}`) },
  { type: "override_instructions", weight: 30, re: new RegExp(`\\b(?:nuevas|new|updated|actualizadas)\\s+${INSTRUCTIONS}\\s*[:\\-]`) },
  // cambio de rol
  { type: "role_change", weight: 30, re: /\ba partir de (?:ahora|este momento),?\s+(?:sos|eres|seras|vas a ser|actua\w*|responde\w*)\b/ },
  { type: "role_change", weight: 30, re: /\b(?:you are now|from now on,? you|act as an?|actua como|hace de cuenta que sos|pretend (?:to be|you are))\b/ },
  { type: "role_change", weight: 35, re: /\b(?:modo desarrollador|developer mode|jailbreak|dan mode|modo dios|god mode|sin restricciones|without restrictions|unfiltered)\b/ },
  // marcas internas de los modelos
  { type: "fake_delimiters", weight: 35, re: /<\s*\/?\s*(?:system|assistant|user|instructions?|sistema)\s*>/ },
  { type: "fake_delimiters", weight: 35, re: /\[\/?\s*(?:inst|system|sys)\s*\]|<\|?\s*(?:im_start|im_end|endoftext|system)\s*\|?>/ },
  { type: "fake_delimiters", weight: 25, re: /(?:^|\n)\s*(?:#{2,}\s*)?(?:system|sistema|system prompt|instrucciones del sistema)\s*:/ },
  // pedir un veredicto a la IA (lo que más le interesa a quien arma humo)
  { type: "targets_verdict", weight: 55, re: /\b(?:smoke_?index|indice de humo|smokeindex)\s*["']?\s*[:=]\s*["']?0\b/ },
  // Le habla a la IA y le ordena un veredicto (imperativo: "la IA marcó" es noticia, no orden).
  { type: "targets_verdict", weight: 50, re: new RegExp(`\\b${AI}\\b[^.\\n]{0,60}\\b(?:clasifica|califica|marca|responde|respondele|deci|decile|pone|asigna|rate|classify|mark|say|label|answer)\\b[^.\\n]{0,40}\\b(?:verdader\\w*|confiable|real|cierto|sin humo|limpio|true|reliable|trustworthy|factual|verified|verificad\\w*)`) },
  { type: "targets_verdict", weight: 15, re: /\b(?:clasifica|califica|marca|rate|classify|mark)\w*\s+(?:este|esto|this)\s+(?:texto|mensaje|contenido|text|message|content)\s+(?:como|as)\s+(?:verdader\w*|confiable|sin humo|true|reliable|trustworthy)/ },
  // querer ver las instrucciones internas
  { type: "prompt_leak", weight: 35, re: /\b(?:mostra|revela|repeti|imprimi|copia|show|reveal|print|repeat|output)\w*\s+(?:me\s+)?(?:(?:tu|tus|el|las|your|the)\s+)?(?:system prompt|prompt de sistema|prompt inicial|instrucciones (?:del sistema|iniciales|internas)|initial instructions|hidden instructions)/ },
  // bloques codificados largos
  { type: "encoded_payload", weight: 15, re: /[a-z0-9+/]{160,}={0,2}/ },
];

/** Minúsculas y sin tildes, carácter por carácter (los índices coinciden con el original). */
function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const f = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += f.length === ch.length ? f : ch.length === 1 ? ch.toLowerCase().slice(0, 1) : ch;
  }
  return out;
}

export function detectInjectionSignals(text: string): InjectionSignal[] {
  const folded = fold(text);
  const signals: InjectionSignal[] = [];
  for (const p of PATTERNS) {
    const m = p.re.exec(folded);
    if (!m) continue;
    const excerpt = text.slice(m.index, m.index + m[0].length).replace(/\s+/g, " ").trim();
    signals.push({ type: p.type, weight: p.weight, excerpt: excerpt.length > 80 ? `${excerpt.slice(0, 79)}…` : excerpt });
  }
  return signals;
}

/** Señales de la limpieza: texto escondido (grave) o muchos invisibles (sospechoso). */
export function hiddenTextSignals(s: { removed: number; hidden: string }): InjectionSignal[] {
  if (s.hidden) return [{ type: "hidden_characters", weight: 40, excerpt: s.hidden.length > 80 ? `${s.hidden.slice(0, 79)}…` : s.hidden }];
  // Uno o dos (un BOM, un guion blando) son comunes al copiar y pegar.
  if (s.removed >= 3) return [{ type: "hidden_characters", weight: 20, excerpt: `${s.removed} caracteres invisibles` }];
  return [];
}

// ---------------- 3) Puntaje y riesgo ----------------

export interface InjectionThresholds {
  low: number;
  high: number;
}

export const DEFAULT_INJECTION_THRESHOLDS: InjectionThresholds = { low: 20, high: 50 };

export function assessInjection(signals: InjectionSignal[], t: InjectionThresholds = DEFAULT_INJECTION_THRESHOLDS): InjectionAssessment {
  // Por tipo, la señal más fuerte (repetir la misma frase no suma).
  const strongest = new Map<InjectionSignalType, InjectionSignal>();
  for (const s of signals) if ((strongest.get(s.type)?.weight ?? -1) < s.weight) strongest.set(s.type, s);
  const kept = [...strongest.values()].sort((a, b) => b.weight - a.weight);
  const score = Math.min(100, kept.reduce((n, s) => n + s.weight, 0));
  return { risk: score >= t.high ? "high" : score >= t.low ? "low" : "none", score, signals: kept };
}

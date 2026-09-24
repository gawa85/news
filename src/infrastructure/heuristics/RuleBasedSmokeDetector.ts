import type { SmokeAnalysis, SmokeFinding, SmokeType } from "../../domain/model";
import type { ISmokeDetector } from "../../domain/ports";
import { extractNumbers, findPhrases, normalize, splitSentences } from "./text";

/** Diccionario de humo. Se inyecta por constructor: se puede ampliar sin tocar la clase. */
export type SmokeLexicon = Record<SmokeType, { phrases: string[]; explanation: string }>;

export const DEFAULT_SMOKE_LEXICON: SmokeLexicon = {
  inflated_adjective: {
    phrases: ["histórico", "histórica", "sin precedentes", "increíble", "revolucionario", "brutal", "impresionante", "extraordinario", "escandaloso"],
    explanation: "Adjetivo que agranda sin aportar un dato.",
  },
  vague_promise: {
    phrases: ["se trabajará", "próximamente", "en los próximos meses", "se buscará", "vamos a", "el compromiso de", "se evaluará"],
    explanation: "Promesa sin fecha, monto ni responsable.",
  },
  filler: {
    phrases: ["cabe destacar", "es importante señalar", "en ese sentido", "sin lugar a dudas", "como no podía ser de otra manera", "a la hora de"],
    explanation: "Frase de relleno: se puede borrar sin perder información.",
  },
  alarmism: {
    phrases: ["caos", "catástrofe", "colapso", "desastre", "tragedia", "alarma", "estallido", "urgente", "atención!!", "no te lo van a decir"],
    explanation: "Lenguaje que busca generar miedo más que informar.",
  },
  marketing: {
    phrases: ["líder", "innovador", "de excelencia", "el mejor", "única oportunidad", "garantizado", "de primer nivel"],
    explanation: "Lenguaje publicitario.",
  },
  unsourced_claim: {
    phrases: ["según fuentes", "fuentes cercanas", "trascendió", "se supo que", "dicen que", "habría"],
    explanation: "Afirmación sin fuente identificable.",
  },
  chain_call: {
    phrases: ["reenviá", "reenvia", "reenvíalo", "reenvialo", "compartí", "comparti esto", "difundí", "difundan", "que llegue a todos", "pasalo"],
    explanation: "Pide que se reenvíe: típico de las cadenas de desinformación.",
  },
};

/**
 * Detector de humo por reglas. Rápido, gratis y sin conexión.
 * Implementa la MISMA interfaz que el detector con IA (LSP): son intercambiables.
 */
export class RuleBasedSmokeDetector implements ISmokeDetector {
  /** La versión cambia sola si cambia el diccionario: cada análisis queda trazado. */
  readonly version: string;

  constructor(private readonly lexicon: SmokeLexicon = DEFAULT_SMOKE_LEXICON) {
    this.version = `reglas-${fingerprint(JSON.stringify(lexicon))}`;
  }

  async analyze(text: string): Promise<SmokeAnalysis> {
    const sentences = splitSentences(text);
    const findings: SmokeFinding[] = [];
    let smokySentences = 0;

    for (const sentence of sentences) {
      let smoky = false;
      for (const [type, entry] of Object.entries(this.lexicon) as [SmokeType, SmokeLexicon[SmokeType]][]) {
        for (const phrase of findPhrases(sentence, entry.phrases)) {
          smoky = true;
          // "reenviá" y "reenvia" son lo mismo: una sola vez por tipo.
          if (!findings.some((f) => f.type === type && normalize(f.excerpt) === normalize(phrase))) {
            findings.push({ type, excerpt: phrase, explanation: entry.explanation });
          }
        }
      }
      if (smoky) smokySentences++;
    }

    // Un "hecho" tiene datos concretos y no se apoya en rumores ni en alarmismo.
    const facts = sentences.filter(
      (s) =>
        extractNumbers(s).length > 0 &&
        findPhrases(s, [...this.lexicon.unsourced_claim.phrases, ...this.lexicon.alarmism.phrases, ...this.lexicon.chain_call.phrases]).length === 0,
    );
    const cleanVersion = facts.map((s) => this.stripSmoke(s)).join(" ");
    const smokeIndex = sentences.length === 0 ? 0 : Math.round((smokySentences / sentences.length) * 100);

    return { smokeIndex, facts, findings, cleanVersion };
  }

  /** Borra frases de relleno y adjetivos inflados de una oración con datos. */
  private stripSmoke(sentence: string): string {
    let out = sentence;
    for (const type of ["filler", "inflated_adjective"] as const) {
      for (const phrase of this.lexicon[type].phrases) {
        const re = new RegExp(`\\s*,?\\s*${escapeRe(phrase)}\\s*,?`, "gi");
        if (normalize(out).includes(normalize(phrase))) out = out.replace(re, " ");
      }
    }
    out = out.replace(/\s{2,}/g, " ").replace(/\s+([.,])/g, "$1").trim();
    return out.charAt(0).toUpperCase() + out.slice(1);
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0").slice(0, 7);
}

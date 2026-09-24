import type { SmokeAnalysis } from "../../domain/model";
import type { ISmokeDetector } from "../../domain/ports";
import type { ILLMClient } from "./ILLMClient";

const SYSTEM = `Sos un editor que separa hechos de "humo" en textos en español.
Tipos de humo: inflated_adjective, vague_promise, filler, alarmism, marketing, unsourced_claim.
Devolvé: {"smokeIndex": 0-100, "facts": [string], "findings": [{"type", "excerpt", "explanation"}], "cleanVersion": string}.
"facts" son sólo afirmaciones concretas (quién, qué, cuándo, cuánto). "cleanVersion" es neutra y breve. No agregues información que no esté en el texto.`;

/** Detector de humo con IA. Mismo contrato que RuleBasedSmokeDetector (LSP). */
export class LLMSmokeDetector implements ISmokeDetector {
  /** Versión = modelo + instrucciones: si cambia cualquiera, es otra versión. */
  readonly version: string;

  constructor(
    private readonly llm: ILLMClient,
    model = "ia",
  ) {
    let h = 0x811c9dc5;
    for (let i = 0; i < SYSTEM.length; i++) h = Math.imul(h ^ SYSTEM.charCodeAt(i), 0x01000193) >>> 0;
    this.version = `ia-${model}-${h.toString(16).slice(0, 7)}`;
  }

  async analyze(text: string): Promise<SmokeAnalysis> {
    const { data: r } = await this.llm.completeJSON<SmokeAnalysis>({ system: SYSTEM, user: text });
    return {
      smokeIndex: Math.max(0, Math.min(100, Math.round(r.smokeIndex ?? 0))),
      facts: r.facts ?? [],
      findings: r.findings ?? [],
      cleanVersion: r.cleanVersion ?? "",
    };
  }
}

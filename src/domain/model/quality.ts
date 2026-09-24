import type { SmokeType } from "./smoke";

/**
 * CALIDAD MEDIBLE: para una herramienta que evalúa la credibilidad de otros,
 * la propia tiene que ser demostrable.
 */
export interface LabeledExample {
  id: string;
  text: string;
  expected: { isSmoke: boolean; types: SmokeType[] };
  source: "curated" | "feedback";
  /** Los ejemplos que vienen de "no me sirvió" entran sin revisar; sólo cuentan los revisados. */
  reviewed: boolean;
  addedBy: string;
  addedAt: Date;
  note?: string;
}

export interface EvaluationMetrics {
  examples: number;
  /** ¿Acertó si el texto tiene humo o no? */
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  /** Por tipo de humo: de lo que marcó, cuánto era cierto (precisión) y de lo que había, cuánto encontró (exhaustividad). */
  perType: Partial<Record<SmokeType, { precision: number; recall: number; support: number }>>;
}

export interface EvaluationRun {
  id: string;
  modelVersion: string;
  at: Date;
  metrics: EvaluationMetrics;
  failures: { exampleId: string; expected: LabeledExample["expected"]; got: { isSmoke: boolean; types: SmokeType[]; smokeIndex: number } }[];
}

export interface ModelVersion {
  id: string;
  engine: "rules" | "llm";
  description: string;
  status: "candidate" | "active" | "retired";
  createdAt: Date;
  lastEvaluation?: EvaluationMetrics;
  promotedAt?: Date;
  promotedBy?: string;
}

export type FeedbackReason = "se_equivoco" | "incompleto" | "no_entendi" | "otro";

export interface AnalysisFeedback {
  id: string;
  analysisId: string;
  userId: string;
  modelVersion?: string;
  useful: boolean;
  reason?: FeedbackReason;
  comment?: string;
  at: Date;
}

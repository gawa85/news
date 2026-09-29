import type { VerdictStatus } from "./claim";

/**
 * DERECHO A RÉPLICA: un medio cuestiona una evaluación de la plataforma.
 * La réplica se muestra SIEMPRE junto a la evaluación, se resuelva como se resuelva.
 */
export type RebuttalTarget =
  | { type: "credibility"; topic: string; dimensionId?: string }
  | { type: "verdict"; claimId: string; requestedStatus?: VerdictStatus }
  | { type: "reply"; replyId: string };

export type RebuttalStatus = "submitted" | "accepted" | "partially_accepted" | "rejected";

export interface Rebuttal {
  id: string;
  outletId: string;
  submittedBy: string;
  target: RebuttalTarget;
  statement: string;
  evidenceUrls: string[];
  status: RebuttalStatus;
  createdAt: Date;
  resolution?: { by: string; note: string; at: Date };
}

/** FE DE ERRATAS: correcciones públicas de la propia plataforma. */
/** Qué puede corregir una fe de erratas: un veredicto, una evaluación de credibilidad, una respuesta publicada, un análisis, la metodología u otra cosa. */
export const CORRECTION_TARGETS = ["verdict", "credibility", "reply", "analysis", "methodology", "other"] as const;
export type CorrectionTarget = (typeof CORRECTION_TARGETS)[number];

export interface Correction {
  id: string;
  target: { type: string; id: string };
  outletId?: string;
  description: string;
  publishedBy: string;
  publishedAt: Date;
  /** Réplica que la originó, si la hubo. */
  rebuttalId?: string;
}

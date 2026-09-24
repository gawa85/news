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

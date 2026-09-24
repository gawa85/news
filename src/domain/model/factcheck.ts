import type { VerdictStatus } from "./claim";

/**
 * FLUJO DE VERIFICACIÓN: cada dato en disputa se convierte en una tarea para
 * el equipo de verificación. Lo resuelto alimenta la "exactitud" de cada medio.
 */
export type VerificationTaskStatus = "open" | "assigned" | "resolved" | "discarded";

export interface EvidenceItem {
  source: string;
  description: string;
  url?: string;
  value?: number;
  date?: string;
  /** "sistema" (fuente primaria automática) o id de quien la cargó. */
  addedBy: string;
  addedAt: Date;
}

export interface VerificationTask {
  id: string;
  topic: string;
  question: string;
  claimIds: string[];
  outletIds: string[];
  figures: number[];
  /** Más alto = más urgente (cuántos medios y afirmaciones involucra). */
  priority: number;
  status: VerificationTaskStatus;
  assigneeId?: string;
  evidence: EvidenceItem[];
  verdicts?: Record<string, VerdictStatus>;
  resolutionNote?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

/** Documento oficial cargado por el equipo (resolución, informe, presupuesto…). */
export interface OfficialDocument {
  id: string;
  title: string;
  issuer: string;
  url: string;
  publishedAt: Date;
  text: string;
  topics: string[];
  uploadedBy: string;
}

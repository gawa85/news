import type { Claim } from "./claim";

/** Grupo de afirmaciones de distintas fuentes que hablan de lo mismo. */
export interface ClaimCluster {
  id: string;
  summary: string;
  claims: Claim[];
  outletIds: string[];
}

export type DisagreementType =
  | "factual" // distintos datos: se puede verificar
  | "interpretive" // mismos datos, distinta lectura
  | "values"; // distintas prioridades: no hay "correcto"

export interface Disagreement {
  type: DisagreementType;
  clusterId: string;
  description: string;
  positions: { outletId: string; claimText: string; claimId?: string }[];
}

export interface Omission {
  outletId: string;
  /** Temas que cubren otras fuentes y esta no menciona. */
  missingClusterIds: string[];
}

/** Transparencia: qué hicieron las reglas de URL del usuario. */
export interface UrlRulesReport {
  /** URLs pedidas por el usuario que entraron en la comparación. */
  included: string[];
  /** URLs pedidas que no se pudieron traer, con el motivo. */
  failedIncludes: { url: string; reason: string }[];
  /** Cuántos resultados de la búsqueda se descartaron por `exclude` u `onlyFrom`. */
  filteredOut: number;
}

export interface SourceComparison {
  topic: string;
  outletIds: string[];
  /** Las URLs concretas usadas, para que el usuario pueda verificar. */
  articleUrls: string[];
  urlRules: UrlRulesReport;
  /** Lo que dicen todas las fuentes, sin contradicciones. */
  agreements: ClaimCluster[];
  /** Lo que dicen varias fuentes (no todas), sin contradicciones. */
  partialAgreements: ClaimCluster[];
  disagreements: Disagreement[];
  omissions: Omission[];
  openQuestions: string[];
}

import type { Period, Region } from "./common";
import type { VerificationState } from "../rules/credibilityVerification";

/**
 * La credibilidad NO es una nota fija del medio:
 * se calcula para un medio, un tema, un período y (opcionalmente) una región.
 */
export interface CredibilityQuery {
  outletId: string;
  topic: string;
  period: Period;
  region?: Region;
}

export interface Evidence {
  description: string;
  articleId?: string;
  url?: string;
}

export interface DimensionScore {
  dimensionId: string;
  label: string;
  /** 0 a 1 (1 = mejor). `null` = no hay datos suficientes para opinar. */
  score: number | null;
  /** 0 a 1: cuánto respaldo tiene el puntaje (cantidad y calidad de datos). */
  confidence: number;
  summary: string;
  evidence: Evidence[];
}

export interface CredibilityReport {
  query: CredibilityQuery;
  outletName: string;
  dimensions: DimensionScore[];
  /** Resumen opcional. El desglose por dimensión es lo principal. Sin datos corroborados, no hay. */
  overall: number | null;
  /** Si hay con qué respaldar el puntaje: verificado, cotejado entre medios o sin corroborar. */
  verification: VerificationState;
  sampleSize: number;
  generatedAt: Date;
  disclaimer: string;
}

export interface CredibilityTimelinePoint {
  period: Period;
  report: CredibilityReport;
}

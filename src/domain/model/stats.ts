import type { ExportFormat } from "./exports";
import type { Period } from "./common";

/**
 * ESTADÍSTICAS: contadores diarios pre-agregados (una fila por día + alcance + métrica + dimensión).
 * Se actualizan a medida que pasan cosas (eventos del dominio), así los paneles no recorren
 * millones de análisis y el observatorio público nunca toca datos individuales.
 */
export type StatScope = "user" | "organization" | "global";

export type StatMetric =
  | "analyses" // análisis hechos
  | "analyses_with_smoke" // de ésos, cuántos tenían humo
  | "smoke_type" // dimensión: tipo de humo
  | "channel" // dimensión: canal por el que llegó
  | "source_type" // dimensión: mail, mensaje, web, rss…
  | "comparisons"
  | "comparison_topic" // dimensión: tema comparado
  | "registrations" // dimensión: canal de alta
  | "activations"; // usuarios que hicieron su primer análisis

export interface StatCounter {
  id: string;
  /** Día en UTC-3 (Argentina), "AAAA-MM-DD". "total" para acumulados de siempre. */
  day: string;
  scope: StatScope;
  scopeId: string;
  metric: StatMetric;
  /** Valor de la dimensión ("" si la métrica no tiene). */
  dim: string;
  value: number;
  /** Versión para actualizar sin pisar a otro servidor (control optimista). */
  rev: number;
}

export interface SeriesPoint {
  day: string;
  value: number;
}

/** Panel de uso de una persona o de una organización. */
export interface UsagePanel {
  scope: "user" | "organization";
  scopeId: string;
  period: Period;
  totals: { analyses: number; withSmoke: number; smokeRate: number | null; comparisons: number };
  daily: { day: string; analyses: number; withSmoke: number; comparisons: number }[];
  smokeTypes: { type: string; count: number }[];
  channels: { channel: string; count: number }[];
  topics: { topic: string; count: number }[];
  /** Organización: cuántos miembros usaron el servicio en el período. */
  activeMembers?: number;
}

/**
 * OBSERVATORIO PÚBLICO: sólo agregados globales, con protección de anonimato:
 * cada grupo necesita un mínimo de personas distintas y los números se redondean.
 */
export interface ObservatoryReport {
  period: Period;
  minGroupSize: number;
  rounding: number;
  totals: { analyses: number; smokeRate: number | null };
  smokeTypes: { type: string; count: number }[];
  channels: { channel: string; count: number }[];
  topics: { topic: string; count: number }[];
  narratives: { id: string; sample: string; occurrences: number; firstSeen: Date; lastSeen: Date; countered: boolean }[];
  /** Cuántos grupos se ocultaron por ser demasiado chicos. */
  suppressedGroups: number;
  methodology: string;
}

/** Métricas del negocio (sólo el equipo de la plataforma). */
export interface BusinessKpis {
  period: Period;
  currency: string;
  /** Ingreso mensual recurrente al final del período (planes anuales prorrateados por 12). */
  mrr: number;
  mrrAtStart: number;
  payingSubjects: number;
  payingAtStart: number;
  newPaying: number;
  churned: number;
  churnRate: number | null;
  arpu: number | null;
  registrations: number;
  activations: number;
  /** Registrados que hicieron al menos un análisis. */
  activationRate: number | null;
  /** Nuevos pagos / registros del período (aproximación). */
  conversionRate: number | null;
  trialing: number;
  byPlan: { planId: string; subjects: number; mrr: number }[];
}

/** Reporte que se genera y se manda solo por mail. */
export type ReportKind = "usage_panel" | "analysis_history" | "impact" | "audit" | "business_kpis";

export interface ReportSchedule {
  id: string;
  ownerId: string;
  organizationId?: string;
  name: string;
  kind: ReportKind;
  /** Panel de uso: el propio o el de la organización. */
  scope?: "user" | "organization";
  format: ExportFormat;
  frequency: "weekly" | "monthly";
  recipients: string[];
  active: boolean;
  nextRunAt: Date;
  lastRunAt?: Date;
  lastError?: string;
  createdAt: Date;
}

/** Dataset de datos abiertos: descripción y licencia, para que se pueda reutilizar. */
export interface OpenDatasetInfo {
  id: string;
  title: string;
  description: string;
  license: string;
  updateFrequency: string;
  columns: { name: string; description: string }[];
}

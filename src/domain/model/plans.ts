import type { ChannelType } from "./identity";

/** Funcionalidades que se venden. Cada plan habilita un subconjunto. */
export const FEATURES = [
  "smoke_analysis",
  "source_comparison",
  "origin_trace",
  "credibility_meter",
  "credibility_timeline",
  "url_rules",
  "alerts",
  "ai_engine",
  "export",
  "api_access",
  "org_rules",
  "content_analysis", // analizar mails reenviados, mensajes y cualquier contenido
  "source_connections", // conectar buzones IMAP, feeds RSS, etc.
  "public_replies", // publicar respuestas en foros y páginas
  "webhooks", // avisos a sistemas externos
  "campaigns", // campañas para contrarrestar el humo
  "team_rooms", // salas en tiempo real de la organización
  "scheduled_reports", // reportes que llegan solos por mail
  "bi_feed", // conexión con herramientas de BI (Power BI, Looker Studio, Metabase)
  "white_label", // marca propia: logo, colores, dominio y remitente
  "learning_mode", // aulas del modo aprendizaje ("¿esto es humo?")
  "audio_replies", // respuestas en audio
  "voice_notes", // entender notas de voz (audio a texto)
] as const;

export type Feature = (typeof FEATURES)[number];

/** `null` = sin límite. */
export type Limit = number | null;

export interface PlanLimits {
  analysesPerDay: Limit;
  comparisonsPerMonth: Limit;
  maxSourcesPerComparison: Limit;
  maxIncludeUrls: Limit;
  maxSavedRuleSets: Limit;
  maxAlerts: Limit;
  maxSourceConnections: Limit;
  seats: Limit;
}

export interface Price {
  amount: number;
  currency: string;
  interval: "month" | "year";
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  audience: "individual" | "organization";
  /** `null` = gratis. Precio mensual (o anual si el plan es sólo anual). */
  price: Price | null;
  /** Precio del plan anual (opcional; suele incluir meses de regalo). */
  yearlyPrice?: Price;
  features: Feature[];
  channels: ChannelType[];
  limits: PlanLimits;
  /** Orden para sugerir upgrades (menor = más barato). */
  tier: number;
}

/** `replaced`: la reemplazó otra (upgrade/downgrade). No cuenta como vigente. */
export type SubscriptionStatus = "pending_payment" | "trialing" | "active" | "past_due" | "canceled" | "replaced";

/** Quién paga: un usuario individual o una organización (que comparte plan y cuota). */
export interface BillingSubject {
  type: "user" | "organization";
  id: string;
}

export interface Subscription {
  id: string;
  subject: BillingSubject;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  createdAt: Date;
  /** Cuándo dejó de valer (reemplazada o cancelada): base de las métricas de bajas. */
  endedAt?: Date;
  /** Período de cobro elegido. */
  interval?: "month" | "year";
  /** Lo que efectivamente se cobra (con cupón, país e impuestos). Si falta, el precio del plan. */
  charged?: { amount: number; currency: string; listAmount: number; couponCode?: string; discountCycles?: number | null; country?: string };
}

export type UsageMetric = "analyses" | "comparisons";

export interface UsageEvent {
  subjectId: string;
  metric: UsageMetric;
  userId: string;
  at: Date;
}

export function isUsable(s: Subscription, now: Date): boolean {
  return (s.status === "active" || s.status === "trialing") && s.currentPeriodEnd >= now;
}

export function withinLimit(limit: Limit, value: number): boolean {
  return limit === null || value <= limit;
}

export function formatPrice(p: Price | null): string {
  if (!p) return "gratis";
  return `${p.currency} ${p.amount.toLocaleString("es-AR")}/${p.interval === "month" ? "mes" : "año"}`;
}

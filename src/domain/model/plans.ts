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
  "screenshots", // leer capturas de pantalla (OCR)
  "evidence_archive", // copias de notas con huella, sello de tiempo y seguimiento de ediciones
  "daily_digest", // resumen diario (el semanal está en todos los planes)
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
  /** Editado desde el backoffice: el arranque ya no lo pisa con la versión del código. */
  customized?: { at: Date; by: string };
  /**
   * `false`: ya no se vende (no se ofrece ni se puede elegir). Quien lo tiene lo conserva.
   * Sin el campo, se vende.
   */
  forSale?: boolean;
}

/**
 * MUDANZA DE SUSCRIPTORES de un plan a otro, avisada con anticipación. En la fecha, cada
 * suscripción vigente pasa al plan nuevo: conserva el período ya pagado y el precio nuevo
 * rige desde el próximo cobro.
 */
export interface PlanMigration {
  id: string;
  fromPlanId: string;
  toPlanId: string;
  status: "scheduled" | "applied" | "canceled";
  announcedAt: Date;
  effectiveAt: Date;
  /** Texto propio que se suma al aviso (por qué cambia). */
  message?: string;
  createdBy: string;
  /** A cuántas personas o equipos se les avisó. */
  notified: number;
  applied?: { at: Date; subscriptions: number };
  canceled?: { at: Date; by: string };
}

/** ¿Se ofrece este plan a quien lo quiera contratar? */
export const onSale = (p: Plan): boolean => p.forSale !== false;

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
  /** Si llegó por una mudanza de plan (no la eligió la persona). */
  migratedFrom?: { planId: string; migrationId: string };
  /** Lo que efectivamente se cobra (con cupón, país e impuestos). Si falta, el precio del plan. */
  charged?: { amount: number; currency: string; listAmount: number; couponCode?: string; discountCycles?: number | null; country?: string };
  /**
   * La persona canceló: sigue con el plan hasta `currentPeriodEnd` (ya lo pagó) y después
   * no se renueva. Se puede deshacer mientras tanto.
   */
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date;
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

import type { Permission } from "./permissions";

/**
 * Clave de API para bots, agentes de IA y clientes MCP.
 * Se guarda sólo el HASH; la clave en claro se muestra una única vez al crearla.
 * `scopes` limita lo que la clave puede hacer (nunca más que el rol del dueño).
 */
export interface ApiKey {
  id: string;
  /** Primeros caracteres visibles para reconocerla ("sh_live_ab12..."). */
  prefix: string;
  hash: string;
  userId: string;
  name: string;
  scopes: Permission[];
  revoked: boolean;
  createdAt: Date;
  lastUsedAt?: Date;
}

/** Eventos a los que un sistema externo puede suscribirse por webhook. */
export const WEBHOOK_EVENTS = [
  "analysis.completed",
  "comparison.completed",
  "alert.triggered",
  "reply.pending_review",
  "reply.published",
  "rebuttal.submitted",
  "correction.published",
  "verification.resolved",
  "campaign.launched",
  "perspective.published",
] as const;

/**
 * Todos los eventos del dominio. Los internos (roles, planes, accesos, claves…)
 * alimentan la auditoría pero no salen por webhook.
 */
export const DOMAIN_EVENTS = [
  ...WEBHOOK_EVENTS,
  "role.assigned",
  "role.removed",
  "organization.created",
  "plan.change_requested",
  "payment.confirmed",
  "reply.reviewed",
  "rules.saved",
  "api_key.created",
  "api_key.revoked",
  "webhook.registered",
  "rebuttal.resolved",
  "outlet_representative.assigned",
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "export.generated",
  "verification.task_created",
  "campaign.reviewed",
  "catalog.imported",
  "model.promoted",
  "invoice.issued",
  "personal_data.exported",
  "personal_data.deleted",
  "user.registered",
  "report.sent",
  "taxonomy.changed",
  "preferences.org_changed",
  "business_rule.changed",
  "parameter.changed",
  "referral.rewarded",
  "branding.updated",
  "branding.domain_verified",
  "coupon.created",
  "feature_flag.changed",
  "support.ticket_created",
  "support.ticket_updated",
  "learning.classroom_created",
  "ops.backup_accessed",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];
export type DomainEventType = (typeof DOMAIN_EVENTS)[number];

export interface DomainEvent {
  id: string;
  type: DomainEventType;
  /** Quién hizo la acción (o a quién le pasó, en eventos del sistema). */
  userId: string;
  organizationId?: string;
  /** Sobre qué: usuario, suscripción, respuesta, réplica… */
  target?: { type: string; id: string };
  occurredAt: Date;
  data: Record<string, unknown>;
}

/** Suscripción de un sistema externo a eventos (webhook saliente, firmado con HMAC). */
export interface WebhookSubscription {
  id: string;
  userId: string;
  url: string;
  events: WebhookEventType[];
  secretRef: string;
  active: boolean;
  createdAt: Date;
}

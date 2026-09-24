import type { ChannelType, User } from "./identity";
import type { Permission } from "./permissions";
import type { Feature, Plan, Subscription, UsageMetric } from "./plans";

export type ActionId =
  | "analyze_smoke"
  | "analyze_content"
  | "compare_sources"
  | "trace_origin"
  | "evaluate_credibility"
  | "credibility_timeline";

/** Qué exige cada acción del producto: permiso (rol), funcionalidad (plan) y si consume cuota. */
export interface ActionDefinition {
  id: ActionId;
  permission: Permission;
  feature: Feature;
  metric?: UsageMetric;
}

/** Todo lo que una regla de negocio necesita para decidir. Se carga una vez por pedido. */
export interface AccessContext {
  user: User;
  permissions: ReadonlySet<Permission>;
  plan: Plan;
  subscription: Subscription;
  usage: Record<UsageMetric, number>;
  action: ActionDefinition;
  channel: ChannelType;
  /** Datos del pedido, para reglas que miran el contenido (p. ej. cuántas URLs incluye). */
  request: { includeUrls?: number; topic?: string };
  now: Date;
}

export type DenialCode =
  | "user_inactive"
  | "subscription_inactive"
  | "no_permission"
  | "feature_not_in_plan"
  | "channel_not_in_plan"
  | "quota_exceeded"
  | "limit_exceeded"
  | "business_rule";

export type RuleDecision =
  | { allowed: true }
  | { allowed: false; code: DenialCode; message: string; feature?: Feature };

export const ALLOW: RuleDecision = { allowed: true };

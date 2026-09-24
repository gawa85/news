import type { ActionId, DenialCode } from "./access";
import type { ChannelType } from "./identity";
import type { Feature, UsageMetric } from "./plans";

/**
 * REGLAS DE NEGOCIO CONFIGURABLES (datos, no código).
 *
 * Dos capas:
 *  1) Reglas FIJAS en código (usuario activo, suscripción, permisos del rol, plan, cuotas,
 *     cumplimiento): no se pueden desactivar desde la configuración.
 *  2) Reglas DECLARATIVAS: "si <condiciones> → <efecto>". Se crean como borrador, se prueban
 *     con escenarios, las aprueba OTRA persona y quedan versionadas y auditadas.
 *     - Las de la plataforma pueden bloquear, limitar o REGALAR una funcionalidad (promociones).
 *     - Las de una organización sólo pueden bloquear o limitar a sus miembros (nunca regalar).
 */
export type ConditionField =
  | "plan" // id del plan
  | "role" // alguno de los roles de la persona
  | "channel"
  | "action"
  | "organization" // id de la organización ("" si no tiene)
  | "topic" // tema del pedido (comparaciones)
  | "hour" // hora local 0-23
  | "weekday" // 0 = domingo … 6 = sábado (hora local)
  | "account_age_days"
  | "date"; // "AAAA-MM-DD" local

export type ConditionOp = "eq" | "neq" | "in" | "not_in" | "gte" | "lte";

export interface RuleCondition {
  field: ConditionField;
  op: ConditionOp;
  value: string | number | (string | number)[];
}

export type RuleEffect =
  | { type: "deny"; message: string }
  | { type: "limit"; metric: UsageMetric; max: number; message?: string }
  | { type: "grant_feature"; feature: Feature };

export type RuleScope = { type: "platform" } | { type: "organization"; id: string };

export type RuleStatus = "draft" | "active" | "archived";

export interface DeclarativeRule {
  /** Id lógico (se mantiene entre versiones). */
  id: string;
  version: number;
  name: string;
  description?: string;
  scope: RuleScope;
  /** Menor = se evalúa antes. */
  priority: number;
  conditions: RuleCondition[];
  effect: RuleEffect;
  status: RuleStatus;
  validFrom?: Date;
  validTo?: Date;
  createdBy: string;
  createdAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
  /** Última prueba con escenarios (sin prueba exitosa no se puede activar). */
  lastTest?: { at: Date; passed: boolean; results: { name: string; expected: string; got: string; ok: boolean }[] };
}

/** Datos que miran las reglas declarativas (se arman desde el contexto de acceso). */
export interface RuleFacts {
  plan: string;
  roles: string[];
  channel: ChannelType;
  action: ActionId;
  organization: string;
  topic?: string;
  hour: number;
  weekday: number;
  account_age_days: number;
  date: string;
  usage: Record<UsageMetric, number>;
}

export interface DeclarativeOutcome {
  grants: { feature: Feature; ruleId: string }[];
  denial?: { code: DenialCode; message: string; ruleId: string };
}

/** Escenario para probar una regla antes de activarla. */
export interface RuleScenario {
  name: string;
  facts: Partial<RuleFacts>;
  expect: "allow" | "deny" | "grant";
}

// ---------------- Parámetros ----------------

/**
 * PARÁMETROS DE NEGOCIO: números y textos que antes eran constantes en el código
 * (umbral de humo, tolerancia de calidad, destinatarios máximos…). Cada uno tiene
 * definición (tipo, rango, valor por defecto) en código y un valor editable en la base.
 */
export interface ParameterDefinition {
  key: string;
  description: string;
  type: "number" | "boolean" | "string";
  default: number | boolean | string;
  min?: number;
  max?: number;
  /** Quién lo puede cambiar: el equipo de la plataforma (siempre con auditoría). */
  unit?: string;
}

export interface ParameterValue {
  key: string;
  value: number | boolean | string;
  version: number;
  updatedAt: Date;
  updatedBy: string;
  reason: string;
}

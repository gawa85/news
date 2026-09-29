/** Lo que devuelve la API del backoffice (fechas como texto ISO). Refleja los tipos del servidor. */

export type TicketStatus = "open" | "pending" | "solved" | "closed";

export interface AgentTicket {
  id: string;
  requesterId: string;
  subject: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: TicketStatus;
  channel: string;
  assigneeId?: string;
  messages: { id: string; authorId: string; role: "requester" | "agent" | "system"; text: string; internal: boolean; at: string }[];
  firstResponseDueAt: string;
  firstRespondedAt?: string;
  slaBreached: boolean;
  createdAt: string;
  updatedAt: string;
}

export type VerdictStatus = "confirmed" | "refuted" | "disputed";

export interface VerificationTask {
  id: string;
  topic: string;
  question: string;
  claimIds: string[];
  outletIds: string[];
  figures: number[];
  priority: number;
  status: "open" | "assigned" | "resolved" | "discarded";
  assigneeId?: string;
  evidence: { source: string; description: string; url?: string; value?: number; date?: string; addedBy: string; addedAt: string }[];
  createdAt: string;
}

export interface NewEvidence {
  source: string;
  description: string;
  url?: string;
  value?: number;
  date?: string;
}

export type RebuttalTarget =
  | { type: "credibility"; topic: string; dimensionId?: string }
  | { type: "verdict"; claimId: string; requestedStatus?: VerdictStatus }
  | { type: "reply"; replyId: string };

export interface PendingRebuttal {
  id: string;
  outletId: string;
  submittedBy: string;
  target: RebuttalTarget;
  statement: string;
  evidenceUrls: string[];
  status: "submitted";
  createdAt: string;
}

export type RebuttalDecision = "accepted" | "partially_accepted" | "rejected";

export interface Restriction {
  id: string;
  target: { kind: "user" | "ip" | "address" | "email"; value: string };
  level: "challenge" | "block";
  reason: string;
  createdAt: string;
  until?: string;
  createdBy: string;
  automatic: boolean;
  liftedAt?: string;
  liftedBy?: string;
}

export interface NewRestriction {
  kind: Restriction["target"]["kind"];
  value: string;
  level: Restriction["level"];
  reason: string;
  hours?: number;
}

export interface BusinessStats {
  period: { from: string; to: string };
  currency: string;
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
  activationRate: number | null;
  conversionRate: number | null;
  trialing: number;
  byPlan: { planId: string; subjects: number; mrr: number }[];
}

export type ParameterValue = number | boolean | string;

export interface Parameter {
  key: string;
  description: string;
  type: "number" | "boolean" | "string";
  default: ParameterValue;
  min?: number;
  max?: number;
  unit?: string;
  value: ParameterValue;
  changed?: { value: ParameterValue; version: number; updatedAt: string; updatedBy: string; reason: string };
}

export type ConditionField = "plan" | "role" | "channel" | "action" | "organization" | "topic" | "hour" | "weekday" | "account_age_days" | "date";
export type ConditionOp = "eq" | "neq" | "in" | "not_in" | "gte" | "lte";

export interface RuleCondition {
  field: ConditionField;
  op: ConditionOp;
  value: string | number | (string | number)[];
}

export type RuleEffect =
  | { type: "deny"; message: string }
  | { type: "limit"; metric: string; max: number; message?: string }
  | { type: "grant_feature"; feature: string };

export interface BusinessRule {
  id: string;
  version: number;
  name: string;
  description?: string;
  scope: { type: "platform" } | { type: "organization"; id: string };
  priority: number;
  conditions: RuleCondition[];
  effect: RuleEffect;
  status: "draft" | "active" | "archived";
  validFrom?: string;
  validTo?: string;
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  lastTest?: RuleTestResult;
}

export interface RuleDraft {
  id?: string;
  name: string;
  description?: string;
  scope: BusinessRule["scope"];
  priority?: number;
  conditions: RuleCondition[];
  effect: RuleEffect;
}

export interface RuleScenario {
  name: string;
  facts: Partial<{ plan: string; roles: string[]; channel: string; action: string; organization: string; topic: string; hour: number; weekday: number; account_age_days: number; date: string }>;
  expect: "allow" | "deny" | "grant";
}

export interface RuleTestResult {
  at: string;
  passed: boolean;
  results: { name: string; expected: string; got: string; ok: boolean }[];
}

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  allowUsers: string[];
  allowOrgs: string[];
  plans: string[];
  countries: string[];
  updatedAt: string;
  updatedBy: string;
}

export type FlagPatch = Partial<Pick<FeatureFlag, "enabled" | "rolloutPercent" | "allowUsers" | "allowOrgs" | "plans" | "countries">>;

export interface Coupon {
  code: string;
  description: string;
  kind: "percent" | "fixed";
  value: number;
  currency?: string;
  planIds: string[];
  intervals: ("month" | "year")[];
  durationCycles: number | null;
  maxRedemptions: number | null;
  redemptions: number;
  newCustomersOnly: boolean;
  validTo?: string;
  active: boolean;
}

export interface NewCoupon {
  code: string;
  description: string;
  kind: "percent" | "fixed";
  value: number;
  planIds: string[];
  maxRedemptions: number | null;
  durationCycles: number | null;
  newCustomersOnly: boolean;
  validTo?: string;
}

export interface NewEvent {
  title: string;
  description?: string;
  host?: string;
  startsAt: string;
  endsAt: string;
  slowModeSeconds?: number;
}

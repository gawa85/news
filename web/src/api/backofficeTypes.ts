/** Lo que devuelve la API del backoffice (fechas como texto ISO). Refleja los tipos del servidor. */
import type { SmokeType } from "./types";

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

// ---- Temas (taxonomy:manage) ----
export interface AdminTopic {
  id: string;
  name: string;
  categoryId: string;
  keywords: string[];
  synonyms: string[];
  sensitive: boolean;
  countries: string[];
  active: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface AdminCategory {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
  order: number;
  active: boolean;
  path: string;
  children: AdminCategory[];
  topics: AdminTopic[];
}

/** Al editar se manda el objeto completo (lo que no se manda vuelve a su valor por defecto). */
export interface TopicDraft {
  id?: string;
  name: string;
  categoryId: string;
  keywords: string[];
  synonyms: string[];
  sensitive: boolean;
  countries: string[];
  active: boolean;
}

export interface CategoryDraft {
  id?: string;
  name: string;
  parentId?: string;
  description?: string;
  active: boolean;
}

// ---- Calidad del algoritmo (quality:manage) ----
export interface ExampleLabel {
  isSmoke: boolean;
  types: SmokeType[];
}

export interface LabeledExample {
  id: string;
  text: string;
  expected: ExampleLabel;
  source: "curated" | "feedback";
  reviewed: boolean;
  addedAt: string;
  note?: string;
}

export interface EvaluationMetrics {
  examples: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  perType: Partial<Record<SmokeType, { precision: number; recall: number; support: number }>>;
}

export interface ModelVersion {
  id: string;
  engine: "rules" | "llm";
  description: string;
  status: "candidate" | "active" | "retired";
  createdAt: string;
  lastEvaluation?: EvaluationMetrics;
  promotedAt?: string;
}

export interface QualityOverview {
  current: string;
  versions: ModelVersion[];
  pendingReview: LabeledExample[];
  reviewedExamples: number;
  usefulness: Record<string, { total: number; useful: number; rate: number }>;
}

export interface EvaluationRun {
  id: string;
  modelVersion: string;
  at: string;
  metrics: EvaluationMetrics;
  failures: { exampleId: string; expected: ExampleLabel; got: ExampleLabel & { smokeIndex: number } }[];
}

// ---- Catálogo (outlets:write) ----
export type CsvKind = "outlets" | "ownership" | "advertising";

export interface CatalogSources {
  sources: { id: string; label: string }[];
  csvUpload: boolean;
}

export interface ImportReport {
  sourceId: string;
  outlets: number;
  owners: number;
  ownership: number;
  advertising: number;
  feeds: number;
  unmatched: string[];
  rejected: string[];
  warnings: string[];
}

// ---- Auditoría (audit:read) ----
export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actorId: string;
  organizationId?: string;
  target?: { type: string; id: string };
  data: Record<string, unknown>;
}

// ---- Costos (plans:manage) ----
export interface CostReport {
  period: { from: string; to: string };
  totalCostUsd: number;
  totalRevenueUsd: number;
  byProvider: Record<string, number>;
  bySubject: { subjectId: string; planId?: string; revenueUsd: number; costUsd: number; marginUsd: number; costShare: number | null; overBudget: boolean }[];
}

// ---- Copias de seguridad (ops:backup) ----
export interface BackupManifest {
  id: string;
  key: string;
  kind: "daily" | "manual" | "pre_migration" | "staging_copy";
  createdAt: string;
  engine: string;
  environment: string;
  collections: Record<string, number>;
  bytes: number;
  sha256: string;
  verifiedAt?: string;
  verification?: { ok: boolean; detail: string };
}

// ---- Documentos oficiales (verdicts:write) ----
export interface NewOfficialDocument {
  title: string;
  issuer: string;
  url: string;
  publishedAt: string;
  text: string;
  topics: string[];
}

export interface OfficialDocument extends NewOfficialDocument {
  id: string;
}

// ---- Personas de la plataforma (users:manage_all) ----
export interface RoleInfo {
  id: string;
  name: string;
  description: string;
  scope: "organization" | "platform";
}

export interface AdminUser {
  id: string;
  name: string;
  status: "active" | "suspended" | "deleted";
  roleIds: string[];
  organization?: { id: string; name: string };
  channels: { channel: string; address: string; verified: boolean }[];
  representsOutletIds: string[];
  suspension?: { reason: string; at: string; by: string };
  createdAt: string;
}

export type UserListFilter = "staff" | "suspended";

// ---- Medios del catálogo (outlets:write) ----
export type OutletKind = "newspaper" | "digital" | "tv" | "radio" | "wire_agency" | "official";

export interface OutletDraft {
  id?: string;
  name: string;
  url: string;
  kind: OutletKind;
  region: { country: string; province?: string; locality?: string };
  aliases: string[];
}

export interface AdminOutlet extends Omit<OutletDraft, "id" | "aliases"> {
  id: string;
  aliases?: string[];
}

export interface OutletFeed {
  id: string;
  outletId: string;
  url: string;
  active: boolean;
  lastFetchedAt?: string;
  lastError?: string;
}

export interface OutletRecord {
  outlet: AdminOutlet;
  feeds: OutletFeed[];
  ownership: { ownerId: string; ownerName: string; since: string; until?: string; source: string }[];
}

// ---- Fe de erratas (corrections:publish) ----
export type CorrectionTarget = "verdict" | "credibility" | "reply" | "analysis" | "methodology" | "other";

export interface NewCorrection {
  target: { type: CorrectionTarget; id: string };
  outletId?: string;
  description: string;
}

// ---- Planes (plans:manage) ----
export interface AdminPlanLimits {
  analysesPerDay: number | null;
  comparisonsPerMonth: number | null;
  maxSourcesPerComparison: number | null;
  maxIncludeUrls: number | null;
  maxSavedRuleSets: number | null;
  maxAlerts: number | null;
  maxSourceConnections: number | null;
  seats: number | null;
}

export interface AdminPlan {
  id: string;
  name: string;
  description: string;
  audience: "individual" | "organization";
  price: { amount: number; currency: string; interval: "month" | "year" } | null;
  yearlyPrice?: { amount: number; currency: string; interval: "year" };
  features: string[];
  limits: AdminPlanLimits;
  tier: number;
  customized?: { at: string; by: string };
  liveSubscriptions: number;
}

export interface PlanCatalog {
  plans: AdminPlan[];
  features: { id: string; label: string }[];
}

/** Se manda el plan completo (lo editable). */
export interface PlanPatch {
  name: string;
  description: string;
  monthlyAmount?: number;
  yearlyAmount: number | null;
  features: string[];
  limits: AdminPlanLimits;
}

// ---- Documentos legales (legal:publish) ----
export interface NewLegalVersion {
  title: string;
  summary: string;
  body: string;
  /** Cambio importante: todas las personas vuelven a aceptar. */
  material: boolean;
  /** Todavía sin revisión legal (se muestra el aviso de borrador). */
  draft: boolean;
}

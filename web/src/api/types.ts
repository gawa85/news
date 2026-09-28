/**
 * Lo que devuelve la API de Sin Humo (las fechas llegan como texto ISO).
 * Reflejan los tipos del backend; si allá cambia algo, se actualiza acá.
 */

export type SmokeType =
  | "inflated_adjective"
  | "vague_promise"
  | "filler"
  | "alarmism"
  | "marketing"
  | "unsourced_claim"
  | "chain_call"
  | "ai_manipulation";

export interface SmokeFinding {
  type: SmokeType;
  excerpt: string;
  explanation: string;
}

export interface SourceSignal {
  id: string;
  level: "ok" | "info" | "warning" | "danger";
  label: string;
  detail: string;
}

export interface AnalyzedLink {
  url: string;
  domain: string;
  outletId?: string;
}

export type SocialPlatform = "youtube" | "x" | "facebook" | "instagram" | "tiktok" | "telegram" | "threads" | "web";

export interface Analysis {
  id: string;
  at: string;
  sourceType: string;
  title?: string;
  text: string;
  smokeIndex: number;
  facts: string[];
  findings: SmokeFinding[];
  cleanVersion: string;
  signals: SourceSignal[];
  links: AnalyzedLink[];
  post?: {
    platform: SocialPlatform;
    url: string;
    author?: { name?: string; handle?: string; url?: string };
    publishedAt?: string;
    metrics?: { views?: number; likes?: number; comments?: number };
  };
  postError?: string;
}

export interface AnalysisSummary {
  id: string;
  at: string;
  sourceType: string;
  title?: string;
  excerpt: string;
  smokeIndex: number;
  findings: number;
}

export interface Price {
  amount: number;
  currency: string;
  interval: "month" | "year";
}

export interface PlanLimits {
  analysesPerDay: number | null;
  comparisonsPerMonth: number | null;
  maxSourcesPerComparison: number | null;
  maxIncludeUrls: number | null;
  seats: number | null;
}

export interface Me {
  id: string;
  name: string;
  country?: string;
  createdAt: string;
  organizationId?: string;
  roles: string[];
  channels: { type: string; address: string; verified: boolean }[];
  plan: { id: string; name: string; features: string[]; limits: PlanLimits; price: Price | null };
  subscription?: { status: string; interval?: "month" | "year"; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; managedByOrganization: boolean };
  usage: { analyses: number; comparisons: number };
  pendingLegal: LegalDocument[];
}

export interface LegalDocument {
  id: "terms" | "privacy";
  title: string;
  version: string;
  url: string;
  summary: string;
  material: boolean;
  draft: boolean;
}

export interface PublicPlan {
  id: string;
  name: string;
  description: string;
  tier: number;
  price: Price | null;
  yearlyPrice?: Price;
  features: { id: string; label: string }[];
  limits: PlanLimits;
}

export interface Quote {
  planId: string;
  interval: "month" | "year";
  currency: string;
  listAmount: number;
  discount: number;
  amount: number;
  coupon?: { code: string; description: string; cycles: number | null };
  tax: { name: string; rate: number; included: boolean; amount: number };
  yearlySavings?: number;
}

export interface Checkout {
  subscription: { id: string; planId: string; status: string };
  checkoutUrl?: string;
}

export type ResponseFormat = "short" | "detailed" | "easy_read";
export type Digest = "off" | "daily" | "weekly";

export interface Preferences {
  followedTopics: string[];
  responseFormat: ResponseFormat;
  language: string;
  quietHours: { from: string; to: string; utcOffsetMinutes: number } | null;
  digest: Digest;
  audioReplies: boolean;
  source: Record<string, "system" | "organization" | "user" | "locked">;
}

export interface Topic {
  id: string;
  name: string;
  synonyms: string[];
}

export interface CategoryNode {
  id: string;
  name: string;
  path: string;
  topics: Topic[];
  children: CategoryNode[];
}

export interface Outlet {
  id: string;
  name: string;
  url: string;
  kind: string;
  region: { country: string; province?: string };
}

export interface Claim {
  id: string;
  outletId: string;
  text: string;
  kind: "fact" | "interpretation" | "value";
}

export interface ClaimCluster {
  id: string;
  summary: string;
  claims: Claim[];
  outletIds: string[];
}

export interface Comparison {
  topic: string;
  outletIds: string[];
  articleUrls: string[];
  agreements: ClaimCluster[];
  partialAgreements: ClaimCluster[];
  disagreements: { type: "factual" | "interpretive" | "values"; clusterId: string; description: string; positions: { outletId: string; claimText: string }[] }[];
  omissions: { outletId: string; missingClusterIds: string[] }[];
  openQuestions: string[];
  urlRules: { included: string[]; failedIncludes: { url: string; reason: string }[]; filteredOut: number };
  blockedIncludes: string[];
}

export interface CredibilityReport {
  outletName: string;
  overall: number | null;
  sampleSize: number;
  disclaimer: string;
  dimensions: { dimensionId: string; label: string; score: number | null; confidence: number; summary: string; evidence: { description: string; url?: string }[] }[];
  corrections: { id: string; description: string; publishedAt: string }[];
  rebuttals: { id: string; statement: string; status: string }[];
}

export type TicketCategory = "account" | "billing" | "bug" | "content_dispute" | "data_request" | "other";

export interface Ticket {
  id: string;
  subject: string;
  category: TicketCategory;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "pending" | "solved" | "closed";
  messages: { id: string; role: "requester" | "agent" | "system"; text: string; at: string }[];
  firstResponseDueAt: string;
  satisfaction?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceSnapshot {
  id: string;
  url: string;
  finalUrl: string;
  capturedAt: string;
  reason: "manual" | "recheck";
  status: "captured" | "gone" | "failed";
  httpStatus?: number;
  error?: string;
  title?: string;
  rawSha256?: string;
  change?: { added: string[]; removed: string[] };
  timestamp?: { provider: string; at: string };
  externalCopies: { provider: string; url: string; at: string }[];
  monitorUntil?: string;
  lastCheckedAt?: string;
}

export interface EvidenceVerification {
  snapshotId: string;
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
}

export interface RoomMessage {
  id: string;
  alias?: string;
  text: string;
  links: string[];
  flags: ("sin_fuente" | "verificacion")[];
  at: string;
  deleted: boolean;
}

export interface PublicEvent {
  id: string;
  code: string;
  title: string;
  description?: string;
  host: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live" | "closed";
  watching: number;
  pinned: RoomMessage[];
}

export type RoomEvent =
  | { type: "history"; messages: RoomMessage[] }
  | { type: "message"; message: RoomMessage }
  | { type: "deleted"; messageId: string }
  | { type: "presence"; count?: number; userIds?: string[] }
  | { type: "closed" };

export interface AuthOptions {
  providers: string[];
  captcha: { provider: string; siteKey: string } | null;
}

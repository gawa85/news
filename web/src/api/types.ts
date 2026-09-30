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
  /** Medios que representa (derecho a réplica). */
  representsOutletIds?: string[];
  /** Permisos efectivos (la web muestra el backoffice según esto; el servidor controla cada acción). */
  permissions: string[];
  channels: { type: string; address: string; verified: boolean }[];
  plan: { id: string; name: string; features: string[]; limits: PlanLimits; price: Price | null };
  subscription?: {
    status: string;
    interval?: "month" | "year";
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    managedByOrganization: boolean;
    /** Mudanza de plan avisada con anticipación. */
    planChange?: { toPlanId: string; toPlanName: string; effectiveAt: string; price: Price; message?: string };
  };
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
  publishedAt?: string;
  /** Texto completo (Markdown simple). Sólo al pedir un documento. */
  body?: string;
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
  /** Sólo en salas de equipo (en eventos públicos nadie ve quién es quién). */
  authorId?: string;
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

export interface ApiKey {
  id: string;
  prefix: string;
  name: string;
  scopes: string[];
  revoked: boolean;
  createdAt: string;
  lastUsedAt?: string;
}

export interface ApiKeyList {
  /** El plan incluye la API y el rol permite crear claves. */
  available: boolean;
  /** Permisos que se le pueden dar a una clave (los del rol). */
  scopes: string[];
  keys: ApiKey[];
}

export type AlertTrigger = "new_coverage" | "new_disagreement" | "credibility_change";

export interface AlertRule {
  id: string;
  topic: string;
  trigger: AlertTrigger;
  channel: string;
  outletId?: string;
  active: boolean;
  createdAt: string;
  lastCheckedAt?: string;
}

export interface TracedArticle {
  id: string;
  title: string;
  url: string;
  outletId: string;
  publishedAt: string;
}

export interface OriginTrace {
  target: TracedArticle;
  origin: TracedArticle;
  chain: { article: TracedArticle; similarityToOrigin: number; isNearCopy: boolean }[];
  independentSources: number;
  likelyPressRelease: boolean;
  echoWarning?: string;
}

export interface TimelinePoint {
  period: { from: string; to: string };
  report: Omit<CredibilityReport, "corrections" | "rebuttals">;
}

export interface QuizQuestion {
  itemId: string;
  text: string;
}

export interface QuizResult {
  correct: boolean;
  wasSmoke: boolean;
  explanation: string;
  streak: number;
  score: { answered: number; correct: number; level: string };
}

export interface LearningProgress {
  answered: number;
  correct: number;
  bestStreak: number;
  level: string;
}

/** Sala de trabajo de un equipo (organización). */
export interface TeamRoom {
  id: string;
  name: string;
  topic?: string;
  createdBy: string;
  createdAt: string;
  slowModeSeconds: number;
}

export interface TeamRoomDetails {
  room: TeamRoom;
  /** Sólo nombres: para mostrar quién escribió. */
  members: { id: string; name: string }[];
  /** Publica chequeos, borra mensajes ajenos y archiva. */
  canModerate: boolean;
}

export interface OrganizationOverview {
  organization: { id: string; name: string; createdAt: string };
  plan: { id: string; name: string };
  /** Los invitados pendientes también ocupan lugar. */
  seats: { used: number; limit: number | null };
  canManage: boolean;
  members: { id: string; name: string; roleIds: string[]; email?: string; isMe: boolean }[];
  roles: { id: string; name: string; description: string }[];
  invitations: { id: string; email: string; roleId: string; createdAt: string; expiresAt: string }[];
}

export interface InvitationPreview {
  organization: string;
  invitedBy: string;
  email: string;
  expiresAt: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  lastDelivery?: { at: string; ok: boolean; status?: number; error?: string };
}

export interface WebhookList {
  available: boolean;
  events: string[];
  webhooks: Webhook[];
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface ReviewTarget {
  type: "analysis" | "reply" | "outlet" | "platform";
  id: string;
}

export interface MyReview {
  rating: number | null;
  text?: string;
  status: "published" | "pending_moderation" | "rejected";
  updatedAt: string;
}

export interface RatingSummary {
  count: number;
  average: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export interface MediaCheckReport {
  kind: "image" | "video";
  summary: string;
  signals: { id: string; level: "info" | "warning"; label: string; detail: string }[];
  file: { width?: number; height?: number; capturedAt?: string; device?: string; software?: string[]; seconds?: number };
}

export interface ObservatoryReport {
  period: { from: string; to: string };
  minGroupSize: number;
  rounding: number;
  totals: { analyses: number; smokeRate: number | null };
  smokeTypes: { type: string; count: number }[];
  channels: { channel: string; count: number }[];
  topics: { topic: string; count: number }[];
  narratives: { id: string; sample: string; occurrences: number; firstSeen: string; lastSeen: string; countered: boolean }[];
  suppressedGroups: number;
  methodology: string;
}

export interface CirculatingNarrative {
  id: string;
  sample: string;
  topic?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  avgSmokeIndex: number;
  status: "circulating" | "countered" | "fading";
  countered: boolean;
}

export interface PublicCorrection {
  id: string;
  target: { type: string; id: string };
  outletId?: string;
  description: string;
  publishedAt: string;
  rebuttalId?: string;
}

export interface PublicRebuttal {
  id: string;
  outletId: string;
  statement: string;
  evidenceUrls: string[];
  status: "submitted" | "accepted" | "partially_accepted" | "rejected";
  createdAt: string;
  resolution?: { note: string; at: string };
}

export interface OutletProfile {
  outlet: Outlet;
  owners: { name: string; businessSectors: string[]; since: string; until?: string; source?: string }[];
  advertising: { payer: string; jurisdiction: string; amount: number; currency: string; source?: string }[];
  rebuttals: PublicRebuttal[];
  corrections: PublicCorrection[];
}

export interface OpenDataset {
  id: string;
  title: string;
  description: string;
  license: string;
  updateFrequency: string;
  columns: { name: string; description: string }[];
}

export interface SourceConnection {
  id: string;
  type: "rss" | "email";
  name: string;
  config: Record<string, string>;
  active: boolean;
  lastSyncAt?: string;
  lastError?: { at: string; message: string };
  createdAt: string;
}

export interface SourceList {
  available: boolean;
  limit: number | null;
  connections: SourceConnection[];
}

export interface UrlRules {
  include?: string[];
  onlyFrom?: string[];
  exclude?: string[];
}

export interface RuleSet {
  id: string;
  name: string;
  urlRules: UrlRules;
  active: boolean;
  createdAt: string;
}

export interface RuleSetList {
  personal: RuleSet[];
  organization: RuleSet[];
  canEditPersonal: boolean;
  canEditOrganization: boolean;
  limit: number | null;
}

export interface UsagePanel {
  scope: "user" | "organization";
  period: { from: string; to: string };
  totals: { analyses: number; withSmoke: number; smokeRate: number | null; comparisons: number };
  daily: { day: string; analyses: number; withSmoke: number; comparisons: number }[];
  smokeTypes: { type: string; count: number }[];
  channels: { channel: string; count: number }[];
  topics: { topic: string; count: number }[];
  activeMembers?: number;
}

export type ExportFormat = "csv" | "xlsx" | "pdf" | "json";

export interface ReportSchedule {
  id: string;
  name: string;
  kind: "usage_panel" | "analysis_history";
  scope?: "user" | "organization";
  format: ExportFormat;
  frequency: "weekly" | "monthly";
  recipients: string[];
  active: boolean;
  nextRunAt: string;
  lastRunAt?: string;
  lastError?: string;
}

export interface ClassroomSummary {
  id: string;
  name: string;
  joinCode: string;
  showLeaderboard: boolean;
  students: number;
  createdAt: string;
}

export interface ClassroomReport {
  classroom: { name: string; joinCode: string; students: number };
  students: { alias: string; answered: number; correct: number; accuracy: number | null }[];
  hardest: { type: string; misses: number }[];
  leaderboard?: string[];
}

export interface ReplyDraft {
  id: string;
  target: { kind: string; destination: string; ref: string; subject?: string };
  content: { title: string; summary?: string; links: { label: string; url: string }[] };
  visibility: "private" | "public";
  status: "pending_review" | "published" | "rejected" | "failed";
  topic?: string;
  createdAt: string;
  publishedAt?: string;
  publishedUrl?: string;
  error?: string;
}

export interface Campaign {
  id: string;
  sponsor: string;
  claim: string;
  message: { title: string; summary?: string; links: { label: string; url: string }[] };
  channelIds: string[];
  topic?: string;
  political: boolean;
  status: "pending_review" | "approved" | "rejected" | "running" | "finished";
  ownerId: string;
  reviewNote?: string;
  riskNotes?: string[];
  createdAt: string;
  launchedAt?: string;
}

export interface CampaignReport {
  deliveries: number;
  reach: number;
  clicks: number;
  alliesAccepted: number;
  narrative?: { weeklyBefore: number; weeklyAfter: number; change: number | null };
}

export interface ReferralSummary {
  code: string;
  invited: number;
  rewarded: number;
  pending: number;
}

export interface Branding {
  organizationId: string;
  displayName: string;
  logoUrl?: string;
  primaryColor?: string;
  footer?: string;
  emailFromName?: string;
  customDomain?: string;
  domainVerifiedAt?: string;
  hidePoweredBy: boolean;
  txt?: { name: string; value: string };
}

// ---- Guía de bienvenida ----
export type OnboardingStepId = "topics" | "chat" | "notifications" | "first_analysis" | "team";

export interface OnboardingStatus {
  steps: { id: OnboardingStepId; done: boolean; skipped: boolean }[];
  pending: number;
  dismissed: boolean;
}

/** Código para vincular un chat: se manda desde WhatsApp o Telegram. */
export interface ChannelLinkCode {
  code: string;
  expiresAt: string;
  whatsappUrl?: string;
  telegramUrl?: string;
}

// ---- Directorio de fuentes públicas conocidas ----
export type DirectoryCategory = "nacional" | "agencia" | "verificador" | "oficial" | "internacional" | "provincial";

export interface DirectoryEntry {
  id: string;
  name: string;
  site: string;
  feedUrl: string;
  category: DirectoryCategory;
  kind: string;
  country: string;
  province?: string;
  description: string;
}

export interface UserDirectory {
  available: boolean;
  limit: number | null;
  used: number;
  entries: (DirectoryEntry & { connected: boolean })[];
}

export interface DirectoryAddResult {
  results: { id: string; name: string; ok: boolean; error?: string }[];
}

/** Resultado de "Leer ahora" una fuente conectada. */
export interface SourceSyncResult {
  connectionId: string;
  analyzed: number;
  withSmoke: number;
  error?: string;
}

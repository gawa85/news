/**
 * Esquema de todas las colecciones: nombre de tabla e índices.
 * Es la única "definición de base de datos" del sistema; vale para todos los motores.
 */
import type {
  AdvertisingSpend,
  AnalysisFeedback,
  EvaluationRun,
  FeedSource,
  LabeledExample,
  ModelVersion,
  Owner,
  OwnershipRecord,
  Campaign,
  CampaignAlly,
  CampaignDelivery,
  Narrative,
  Perspective,
  PerspectiveVote,
  Room,
  RoomMessage,
  CostEvent,
  BillingProfile,
  Invoice,
  Job,
  OfficialDocument,
  VerificationTask,
  AuditEntry,
  Correction,
  LoginAttempt,
  MagicLink,
  OAuthState,
  PasswordCredential,
  Rebuttal,
  Session,
  ApiKey,
  DeliveryAttempt,
  DestinationHealth,
  ImpactSnapshot,
  OptOut,
  ReplyDraft,
  Review,
  TrackedLink,
  WebhookSubscription,
  AlertRule,
  Article,
  Claim,
  ClaimVerdict,
  ContentAnalysis,
  Organization,
  Outlet,
  Plan,
  Role,
  SavedRuleSet,
  SourceConnection,
  Subscription,
  UsageEvent,
  User,
} from "../../domain/model";
import type { SecretRecord, VerificationCodeRecord } from "../../domain/ports";
import type { CollectionSchema } from "./collection";
import type { Branding, Coupon, CouponRedemption, ReferralCode, ReferralUse } from "../../domain/model";
import type { ConsentRecord } from "../../domain/model";
import type { Classroom, ClassroomMember, FeatureFlag, LearningState, QuizAttempt, QuizItem, Ticket } from "../../domain/model";

/** Archivo propio (audio de respuesta) guardado en la base, con vencimiento. */
export interface MediaRecord {
  id: string;
  mime: string;
  dataBase64: string;
  expiresAt: Date;
}
import type { Category, DeclarativeRule, OrgPreferenceDefaults, ParameterValue, ReportSchedule, StatCounter, Topic, UserPreferences } from "../../domain/model";

/** Quién sigue qué tema (índice para encontrar seguidores sin recorrer todas las preferencias). */
export interface TopicFollow {
  id: string;
  topicId: string;
  userId: string;
}

/** Persona distinta que aportó a un grupo del observatorio (seudónimo, nunca el id). */
export interface StatContributor {
  id: string;
  group: string;
}

export interface ChannelLink {
  id: string; // "canal:dirección" → clave única
  userId: string;
}

export type UsageRow = UsageEvent & { id: string };
export interface ConversationWindow {
  id: string; // "canal:dirección"
  lastInboundAt: Date;
}

const subjectKey = (s: { type: string; id: string }) => `${s.type}:${s.id}`;

export const schemas = {
  outlets: { name: "outlets", idOf: (o: Outlet) => o.id, indexes: {} } satisfies CollectionSchema<Outlet>,
  articles: {
    name: "articles",
    idOf: (a: Article) => a.id,
    indexes: {
      outletId: { type: "text", get: (a: Article) => a.outletId },
      topic: { type: "text", get: (a: Article) => a.topic },
      publishedAt: { type: "text", get: (a: Article) => a.publishedAt },
    },
  } satisfies CollectionSchema<Article>,
  claims: {
    name: "claims",
    idOf: (c: Claim) => c.id,
    indexes: { articleId: { type: "text", get: (c: Claim) => c.articleId } },
  } satisfies CollectionSchema<Claim>,
  verdicts: {
    name: "verdicts",
    idOf: (v: ClaimVerdict) => `${v.claimId}@${v.checkedAt.toISOString()}`,
    indexes: { claimId: { type: "text", get: (v: ClaimVerdict) => v.claimId } },
  } satisfies CollectionSchema<ClaimVerdict>,
  users: {
    name: "users",
    idOf: (u: User) => u.id,
    indexes: { organizationId: { type: "text", get: (u: User) => u.organizationId ?? null } },
  } satisfies CollectionSchema<User>,
  channelLinks: {
    name: "channel_links",
    idOf: (l: ChannelLink) => l.id,
    indexes: { userId: { type: "text", get: (l: ChannelLink) => l.userId } },
  } satisfies CollectionSchema<ChannelLink>,
  roles: { name: "roles", idOf: (r: Role) => r.id, indexes: {} } satisfies CollectionSchema<Role>,
  organizations: { name: "organizations", idOf: (o: Organization) => o.id, indexes: {} } satisfies CollectionSchema<Organization>,
  plans: {
    name: "plans",
    idOf: (p: Plan) => p.id,
    indexes: { tier: { type: "number", get: (p: Plan) => p.tier } },
  } satisfies CollectionSchema<Plan>,
  subscriptions: {
    name: "subscriptions",
    idOf: (s: Subscription) => s.id,
    indexes: {
      subject: { type: "text", get: (s: Subscription) => subjectKey(s.subject) },
      status: { type: "text", get: (s: Subscription) => s.status },
      createdAt: { type: "text", get: (s: Subscription) => s.createdAt },
    },
  } satisfies CollectionSchema<Subscription>,
  usage: {
    name: "usage_events",
    idOf: (u: UsageRow) => u.id,
    indexes: {
      subjectId: { type: "text", get: (u: UsageRow) => u.subjectId },
      metric: { type: "text", get: (u: UsageRow) => u.metric },
      at: { type: "text", get: (u: UsageRow) => u.at },
    },
  } satisfies CollectionSchema<UsageRow>,
  ruleSets: {
    name: "rule_sets",
    idOf: (r: SavedRuleSet) => r.id,
    indexes: {
      owner: { type: "text", get: (r: SavedRuleSet) => subjectKey(r.owner) },
      active: { type: "number", get: (r: SavedRuleSet) => r.active },
    },
  } satisfies CollectionSchema<SavedRuleSet>,
  alerts: {
    name: "alert_rules",
    idOf: (a: AlertRule) => a.id,
    indexes: {
      userId: { type: "text", get: (a: AlertRule) => a.userId },
      topic: { type: "text", get: (a: AlertRule) => a.topic },
      active: { type: "number", get: (a: AlertRule) => a.active },
    },
  } satisfies CollectionSchema<AlertRule>,
  contentAnalyses: {
    name: "content_analyses",
    idOf: (c: ContentAnalysis) => c.id,
    indexes: {
      userId: { type: "text", get: (c: ContentAnalysis) => c.userId },
      analyzedAt: { type: "text", get: (c: ContentAnalysis) => c.analyzedAt },
    },
  } satisfies CollectionSchema<ContentAnalysis>,
  sourceConnections: {
    name: "source_connections",
    idOf: (c: SourceConnection) => c.id,
    indexes: {
      userId: { type: "text", get: (c: SourceConnection) => c.userId },
      active: { type: "number", get: (c: SourceConnection) => c.active },
    },
  } satisfies CollectionSchema<SourceConnection>,
  secrets: { name: "secrets", idOf: (s: SecretRecord) => s.ref, indexes: {} } satisfies CollectionSchema<SecretRecord>,
  verificationCodes: {
    name: "verification_codes",
    idOf: (v: VerificationCodeRecord) => v.key,
    indexes: {},
  } satisfies CollectionSchema<VerificationCodeRecord>,
  replyDrafts: {
    name: "reply_drafts",
    idOf: (r: ReplyDraft) => r.id,
    indexes: {
      status: { type: "text", get: (r: ReplyDraft) => r.status },
      publishedAt: { type: "text", get: (r: ReplyDraft) => r.publishedAt ?? null },
      createdAt: { type: "text", get: (r: ReplyDraft) => r.createdAt },
    },
  } satisfies CollectionSchema<ReplyDraft>,
  apiKeys: {
    name: "api_keys",
    idOf: (k: ApiKey) => k.id,
    indexes: {
      hash: { type: "text", get: (k: ApiKey) => k.hash },
      userId: { type: "text", get: (k: ApiKey) => k.userId },
    },
  } satisfies CollectionSchema<ApiKey>,
  webhooks: {
    name: "webhooks",
    idOf: (w: WebhookSubscription) => w.id,
    indexes: {
      userId: { type: "text", get: (w: WebhookSubscription) => w.userId },
      active: { type: "number", get: (w: WebhookSubscription) => w.active },
    },
  } satisfies CollectionSchema<WebhookSubscription>,
  reviews: {
    name: "reviews",
    idOf: (r: Review) => r.id,
    indexes: {
      target: { type: "text", get: (r: Review) => `${r.target.type}:${r.target.id}` },
      status: { type: "text", get: (r: Review) => r.status },
      author: { type: "text", get: (r: Review) => (r.origin.kind === "internal" ? r.origin.userId : null) },
    },
  } satisfies CollectionSchema<Review>,
  impact: {
    name: "impact_snapshots",
    idOf: (i: ImpactSnapshot) => i.id,
    indexes: {
      replyId: { type: "text", get: (i: ImpactSnapshot) => i.replyId },
      collectedAt: { type: "text", get: (i: ImpactSnapshot) => i.collectedAt },
    },
  } satisfies CollectionSchema<ImpactSnapshot>,
  trackedLinks: {
    name: "tracked_links",
    idOf: (t: TrackedLink) => t.code,
    indexes: { replyId: { type: "text", get: (t: TrackedLink) => t.replyId } },
  } satisfies CollectionSchema<TrackedLink>,
  deliveryLog: {
    name: "delivery_log",
    idOf: (d: DeliveryAttempt) => d.id,
    indexes: {
      destination: { type: "text", get: (d: DeliveryAttempt) => d.destination },
      recipientHash: { type: "text", get: (d: DeliveryAttempt) => d.recipientHash },
      outcome: { type: "text", get: (d: DeliveryAttempt) => d.outcome },
      at: { type: "text", get: (d: DeliveryAttempt) => d.at },
    },
  } satisfies CollectionSchema<DeliveryAttempt>,
  destinationHealth: {
    name: "destination_health",
    idOf: (h: DestinationHealth) => h.destination,
    indexes: {},
  } satisfies CollectionSchema<DestinationHealth>,
  optOuts: {
    name: "opt_outs",
    idOf: (o: OptOut) => `${o.channel}:${o.address.trim().toLowerCase()}`,
    indexes: {},
  } satisfies CollectionSchema<OptOut>,
  conversationWindows: {
    name: "conversation_windows",
    idOf: (c: ConversationWindow) => c.id,
    indexes: {},
  } satisfies CollectionSchema<ConversationWindow>,
  audit: {
    name: "audit_log",
    idOf: (a: AuditEntry) => a.id,
    indexes: {
      at: { type: "text", get: (a: AuditEntry) => a.at },
      actorId: { type: "text", get: (a: AuditEntry) => a.actorId },
      organizationId: { type: "text", get: (a: AuditEntry) => a.organizationId ?? null },
      action: { type: "text", get: (a: AuditEntry) => a.action },
    },
  } satisfies CollectionSchema<AuditEntry>,
  sessions: {
    name: "sessions",
    idOf: (s: Session) => s.id,
    indexes: { userId: { type: "text", get: (s: Session) => s.userId } },
  } satisfies CollectionSchema<Session>,
  credentials: {
    name: "password_credentials",
    idOf: (c: PasswordCredential) => c.email,
    indexes: { userId: { type: "text", get: (c: PasswordCredential) => c.userId } },
  } satisfies CollectionSchema<PasswordCredential>,
  magicLinks: { name: "magic_links", idOf: (m: MagicLink) => m.id, indexes: {} } satisfies CollectionSchema<MagicLink>,
  oauthStates: { name: "oauth_states", idOf: (o: OAuthState) => o.state, indexes: {} } satisfies CollectionSchema<OAuthState>,
  loginAttempts: {
    name: "login_attempts",
    idOf: (l: LoginAttempt) => l.id,
    indexes: {
      identifierHash: { type: "text", get: (l: LoginAttempt) => l.identifierHash },
      ok: { type: "number", get: (l: LoginAttempt) => l.ok },
      at: { type: "text", get: (l: LoginAttempt) => l.at },
    },
  } satisfies CollectionSchema<LoginAttempt>,
  rebuttals: {
    name: "rebuttals",
    idOf: (r: Rebuttal) => r.id,
    indexes: {
      outletId: { type: "text", get: (r: Rebuttal) => r.outletId },
      status: { type: "text", get: (r: Rebuttal) => r.status },
      createdAt: { type: "text", get: (r: Rebuttal) => r.createdAt },
    },
  } satisfies CollectionSchema<Rebuttal>,
  corrections: {
    name: "corrections",
    idOf: (c: Correction) => c.id,
    indexes: {
      outletId: { type: "text", get: (c: Correction) => c.outletId ?? null },
      publishedAt: { type: "text", get: (c: Correction) => c.publishedAt },
    },
  } satisfies CollectionSchema<Correction>,
  jobs: {
    name: "jobs",
    idOf: (j: Job) => j.id,
    indexes: {
      status: { type: "text", get: (j: Job) => j.status },
      runAt: { type: "text", get: (j: Job) => j.runAt },
      lockedBy: { type: "text", get: (j: Job) => j.lockedBy ?? null },
      lockedUntil: { type: "text", get: (j: Job) => j.lockedUntil ?? null },
      finishedAt: { type: "text", get: (j: Job) => j.finishedAt ?? null },
    },
  } satisfies CollectionSchema<Job>,
  verificationTasks: {
    name: "verification_tasks",
    idOf: (t: VerificationTask) => t.id,
    indexes: {
      status: { type: "text", get: (t: VerificationTask) => t.status },
      priority: { type: "number", get: (t: VerificationTask) => t.priority },
    },
  } satisfies CollectionSchema<VerificationTask>,
  officialDocuments: {
    name: "official_documents",
    idOf: (d: OfficialDocument) => d.id,
    indexes: { publishedAt: { type: "text", get: (d: OfficialDocument) => d.publishedAt } },
  } satisfies CollectionSchema<OfficialDocument>,
  billingProfiles: { name: "billing_profiles", idOf: (b: BillingProfile) => subjectKey(b.subject), indexes: {} } satisfies CollectionSchema<BillingProfile>,
  invoices: {
    name: "invoices",
    idOf: (i: Invoice) => i.id,
    indexes: {
      subject: { type: "text", get: (i: Invoice) => subjectKey(i.subject) },
      issueDate: { type: "text", get: (i: Invoice) => i.issueDate },
    },
  } satisfies CollectionSchema<Invoice>,
  costs: {
    name: "cost_events",
    idOf: (c: CostEvent) => c.id,
    indexes: {
      at: { type: "text", get: (c: CostEvent) => c.at },
      subjectId: { type: "text", get: (c: CostEvent) => c.subjectId },
    },
  } satisfies CollectionSchema<CostEvent>,
  narratives: {
    name: "narratives",
    idOf: (n: Narrative) => n.id,
    indexes: {
      lastSeenAt: { type: "text", get: (n: Narrative) => n.lastSeenAt },
      occurrences: { type: "number", get: (n: Narrative) => n.occurrences },
    },
  } satisfies CollectionSchema<Narrative>,
  campaigns: {
    name: "campaigns",
    idOf: (c: Campaign) => c.id,
    indexes: { status: { type: "text", get: (c: Campaign) => c.status } },
  } satisfies CollectionSchema<Campaign>,
  campaignAllies: {
    name: "campaign_allies",
    idOf: (a: CampaignAlly) => a.id,
    indexes: { campaignId: { type: "text", get: (a: CampaignAlly) => a.campaignId } },
  } satisfies CollectionSchema<CampaignAlly>,
  campaignDeliveries: {
    name: "campaign_deliveries",
    idOf: (d: CampaignDelivery) => d.id,
    indexes: { campaignId: { type: "text", get: (d: CampaignDelivery) => d.campaignId } },
  } satisfies CollectionSchema<CampaignDelivery>,
  perspectives: {
    name: "perspectives",
    idOf: (p: Perspective) => p.id,
    indexes: { target: { type: "text", get: (p: Perspective) => `${p.target.type}:${p.target.id}` } },
  } satisfies CollectionSchema<Perspective>,
  perspectiveVotes: { name: "perspective_votes", idOf: (v: PerspectiveVote) => v.id, indexes: {} } satisfies CollectionSchema<PerspectiveVote>,
  rooms: {
    name: "rooms",
    idOf: (r: Room) => r.id,
    indexes: { organizationId: { type: "text", get: (r: Room) => r.organizationId } },
  } satisfies CollectionSchema<Room>,
  roomMessages: {
    name: "room_messages",
    idOf: (m: RoomMessage) => m.id,
    indexes: {
      roomId: { type: "text", get: (m: RoomMessage) => m.roomId },
      authorId: { type: "text", get: (m: RoomMessage) => m.authorId },
      at: { type: "text", get: (m: RoomMessage) => m.at },
    },
  } satisfies CollectionSchema<RoomMessage>,
  owners: { name: "owners", idOf: (o: Owner) => o.id, indexes: {} } satisfies CollectionSchema<Owner>,
  ownership: {
    name: "ownership_records",
    idOf: (r: OwnershipRecord) => `${r.outletId}|${r.ownerId}|${r.since.toISOString()}`,
    indexes: { outletId: { type: "text", get: (r: OwnershipRecord) => r.outletId } },
  } satisfies CollectionSchema<OwnershipRecord>,
  advertising: {
    name: "advertising_spend",
    idOf: (a: AdvertisingSpend) => `${a.outletId}|${a.payer}|${a.period.from.toISOString()}|${a.period.to.toISOString()}`,
    indexes: {
      outletId: { type: "text", get: (a: AdvertisingSpend) => a.outletId },
      from: { type: "text", get: (a: AdvertisingSpend) => a.period.from },
      to: { type: "text", get: (a: AdvertisingSpend) => a.period.to },
    },
  } satisfies CollectionSchema<AdvertisingSpend>,
  feeds: {
    name: "feed_sources",
    idOf: (f: FeedSource) => f.id,
    indexes: { active: { type: "number", get: (f: FeedSource) => f.active } },
  } satisfies CollectionSchema<FeedSource>,
  examples: { name: "labeled_examples", idOf: (e: LabeledExample) => e.id, indexes: {} } satisfies CollectionSchema<LabeledExample>,
  modelVersions: { name: "model_versions", idOf: (v: ModelVersion) => v.id, indexes: {} } satisfies CollectionSchema<ModelVersion>,
  evaluationRuns: {
    name: "evaluation_runs",
    idOf: (r: EvaluationRun) => r.id,
    indexes: { modelVersion: { type: "text", get: (r: EvaluationRun) => r.modelVersion }, at: { type: "text", get: (r: EvaluationRun) => r.at } },
  } satisfies CollectionSchema<EvaluationRun>,
  statCounters: {
    name: "stat_counters",
    idOf: (c: StatCounter) => c.id,
    indexes: {
      series: { type: "text", get: (c: StatCounter) => `${c.scope}:${c.scopeId}` },
      metric: { type: "text", get: (c: StatCounter) => c.metric },
      day: { type: "text", get: (c: StatCounter) => c.day },
      rev: { type: "number", get: (c: StatCounter) => c.rev },
    },
  } satisfies CollectionSchema<StatCounter>,
  statContributors: {
    name: "stat_contributors",
    idOf: (c: StatContributor) => c.id,
    indexes: { group: { type: "text", get: (c: StatContributor) => c.group } },
  } satisfies CollectionSchema<StatContributor>,
  reportSchedules: {
    name: "report_schedules",
    idOf: (r: ReportSchedule) => r.id,
    indexes: {
      ownerId: { type: "text", get: (r: ReportSchedule) => r.ownerId },
      active: { type: "number", get: (r: ReportSchedule) => r.active },
      nextRunAt: { type: "text", get: (r: ReportSchedule) => r.nextRunAt },
    },
  } satisfies CollectionSchema<ReportSchedule>,
  categories: { name: "categories", idOf: (c: Category) => c.id, indexes: {} } satisfies CollectionSchema<Category>,
  topics: { name: "topics", idOf: (t: Topic) => t.id, indexes: { categoryId: { type: "text", get: (t: Topic) => t.categoryId } } } satisfies CollectionSchema<Topic>,
  userPreferences: { name: "user_preferences", idOf: (p: UserPreferences) => p.userId, indexes: {} } satisfies CollectionSchema<UserPreferences>,
  orgPreferences: { name: "org_preference_defaults", idOf: (p: OrgPreferenceDefaults) => p.organizationId, indexes: {} } satisfies CollectionSchema<OrgPreferenceDefaults>,
  topicFollows: {
    name: "topic_follows",
    idOf: (f: TopicFollow) => f.id,
    indexes: { topicId: { type: "text", get: (f: TopicFollow) => f.topicId }, userId: { type: "text", get: (f: TopicFollow) => f.userId } },
  } satisfies CollectionSchema<TopicFollow>,
  businessRules: {
    name: "business_rules",
    idOf: (r: DeclarativeRule) => `${r.id}|${String(r.version).padStart(6, "0")}`,
    indexes: {
      ruleId: { type: "text", get: (r: DeclarativeRule) => r.id },
      version: { type: "number", get: (r: DeclarativeRule) => r.version },
      status: { type: "text", get: (r: DeclarativeRule) => r.status },
    },
  } satisfies CollectionSchema<DeclarativeRule>,
  parameters: {
    name: "business_parameters",
    idOf: (v: ParameterValue) => `${v.key}|${String(v.version).padStart(6, "0")}`,
    indexes: { key: { type: "text", get: (v: ParameterValue) => v.key }, version: { type: "number", get: (v: ParameterValue) => v.version } },
  } satisfies CollectionSchema<ParameterValue>,
  coupons: {
    name: "coupons",
    idOf: (c: Coupon) => c.code,
    indexes: { redemptions: { type: "number", get: (c: Coupon) => c.redemptions } },
  } satisfies CollectionSchema<Coupon>,
  couponRedemptions: {
    name: "coupon_redemptions",
    idOf: (r: CouponRedemption) => r.id,
    indexes: { subject: { type: "text", get: (r: CouponRedemption) => `${r.subject.type}:${r.subject.id}` } },
  } satisfies CollectionSchema<CouponRedemption>,
  referralCodes: {
    name: "referral_codes",
    idOf: (c: ReferralCode) => c.code,
    indexes: { ownerId: { type: "text", get: (c: ReferralCode) => c.ownerId } },
  } satisfies CollectionSchema<ReferralCode>,
  referralUses: {
    name: "referral_uses",
    idOf: (u: ReferralUse) => u.id,
    indexes: { referrerId: { type: "text", get: (u: ReferralUse) => u.referrerId } },
  } satisfies CollectionSchema<ReferralUse>,
  branding: {
    name: "branding",
    idOf: (b: Branding) => b.organizationId,
    indexes: { customDomain: { type: "text", get: (b: Branding) => b.customDomain ?? null } },
  } satisfies CollectionSchema<Branding>,
  consents: {
    name: "legal_consents",
    idOf: (c: ConsentRecord) => c.id,
    indexes: { userId: { type: "text", get: (c: ConsentRecord) => c.userId } },
  } satisfies CollectionSchema<ConsentRecord>,
  quizItems: { name: "quiz_items", idOf: (i: QuizItem) => i.id, indexes: {} } satisfies CollectionSchema<QuizItem>,
  classrooms: {
    name: "classrooms",
    idOf: (c: Classroom) => c.id,
    indexes: { joinCode: { type: "text", get: (c: Classroom) => c.joinCode }, teacherId: { type: "text", get: (c: Classroom) => c.teacherId } },
  } satisfies CollectionSchema<Classroom>,
  classroomMembers: {
    name: "classroom_members",
    idOf: (m: ClassroomMember) => m.id,
    indexes: { classroomId: { type: "text", get: (m: ClassroomMember) => m.classroomId }, userId: { type: "text", get: (m: ClassroomMember) => m.userId } },
  } satisfies CollectionSchema<ClassroomMember>,
  quizAttempts: {
    name: "quiz_attempts",
    idOf: (a: QuizAttempt) => a.id,
    indexes: { playerId: { type: "text", get: (a: QuizAttempt) => a.playerId }, classroomId: { type: "text", get: (a: QuizAttempt) => a.classroomId ?? null } },
  } satisfies CollectionSchema<QuizAttempt>,
  learningStates: { name: "learning_states", idOf: (s: LearningState) => s.playerId, indexes: {} } satisfies CollectionSchema<LearningState>,
  tickets: {
    name: "support_tickets",
    idOf: (t: Ticket) => t.id,
    indexes: {
      requesterId: { type: "text", get: (t: Ticket) => t.requesterId },
      status: { type: "text", get: (t: Ticket) => t.status },
      createdAt: { type: "text", get: (t: Ticket) => t.createdAt },
    },
  } satisfies CollectionSchema<Ticket>,
  featureFlags: { name: "feature_flags", idOf: (f: FeatureFlag) => f.key, indexes: {} } satisfies CollectionSchema<FeatureFlag>,
  media: {
    name: "media_files",
    idOf: (m: MediaRecord) => m.id,
    indexes: { expiresAt: { type: "text", get: (m: MediaRecord) => m.expiresAt } },
  } satisfies CollectionSchema<MediaRecord>,
  feedback: {
    name: "analysis_feedback",
    idOf: (f: AnalysisFeedback) => f.id,
    indexes: { at: { type: "text", get: (f: AnalysisFeedback) => f.at } },
  } satisfies CollectionSchema<AnalysisFeedback>,
};

export const subjectKeyOf = subjectKey;

import type { BackofficeApi } from "../api/BackofficeApi";
import type {
  AgentTicket,
  Coupon,
  NewCoupon,
  BusinessRule,
  FeatureFlag,
  FlagPatch,
  NewRestriction,
  Parameter,
  PendingRebuttal,
  Restriction,
  RuleDraft,
  RuleScenario,
  TicketStatus,
  VerificationTask,
  AdminCategory,
  AuditEntry,
  BackupManifest,
  CatalogSources,
  CategoryDraft,
  CsvKind,
  ExampleLabel,
  ImportReport,
  NewOfficialDocument,
  QualityOverview,
  TopicDraft,
  AdminUser,
  RoleInfo,
  UserListFilter,
  AdminOutlet,
  OutletDraft,
  OutletFeed,
  OutletRecord,
  NewCorrection,
  AdminPlan,
  PlanCatalog,
  PlanPatch,
  NewLegalVersion,
  NewPlan,
} from "../api/backofficeTypes";
import type { PublicEvent } from "../api/types";

/** Backoffice falso (misma interfaz que el real): las pantallas se prueban sin servidor. */
export class FakeBackoffice implements BackofficeApi {
  calls: { method: string; args: unknown[] }[] = [];
  private log(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  tickets: AgentTicket[] = [
    {
      id: "T-1", requesterId: "u9", subject: "No me llega el enlace", category: "account", priority: "urgent", status: "open", channel: "web",
      messages: [{ id: "m1", authorId: "u9", role: "requester", text: "Pedí el enlace tres veces y no llega.", internal: false, at: "2026-09-28T10:00:00Z" }],
      firstResponseDueAt: "2026-09-28T12:00:00Z", slaBreached: true, createdAt: "2026-09-28T10:00:00Z", updatedAt: "2026-09-28T10:00:00Z",
    },
  ];
  async supportQueue() {
    return this.tickets;
  }
  async replyAsAgent(ticketId: string, text: string, opts: { internal?: boolean; status?: TicketStatus }) {
    this.log("replyAsAgent", ticketId, text, opts);
    const t = this.tickets.find((x) => x.id === ticketId)!;
    const next = { ...t, status: opts.status ?? (opts.internal ? t.status : "pending"), firstRespondedAt: opts.internal ? t.firstRespondedAt : "2026-09-28T11:00:00Z", messages: [...t.messages, { id: "m2", authorId: "a1", role: "agent" as const, text, internal: !!opts.internal, at: "2026-09-28T11:00:00Z" }] };
    this.tickets = this.tickets.map((x) => (x.id === ticketId ? next : x));
    return next;
  }

  tasks: VerificationTask[] = [
    { id: "vt1", topic: "tarifas de gas", question: "¿El aumento es de 30% o de 18%?", claimIds: ["c1", "c2"], outletIds: ["ddv"], figures: [30, 18], priority: 5, status: "open", evidence: [], createdAt: "2026-09-27T10:00:00Z" },
  ];
  private task(id: string, patch: Partial<VerificationTask>) {
    const t = { ...this.tasks.find((x) => x.id === id)!, ...patch };
    this.tasks = this.tasks.map((x) => (x.id === id ? t : x));
    return t;
  }
  async verificationTasks() {
    return this.tasks;
  }
  async takeTask(id: string) {
    this.log("takeTask", id);
    return this.task(id, { status: "assigned", assigneeId: "u1" });
  }
  async suggestEvidence(id: string) {
    return this.task(id, { evidence: [{ source: "Boletín Oficial", description: "Resolución 45: aumento de 30%", url: "https://boletin.example/45", addedBy: "sistema", addedAt: "2026-09-28T10:00:00Z" }] });
  }
  async addEvidence(id: string, e: { source: string; description: string; url?: string }) {
    this.log("addEvidence", id, e);
    const t = this.tasks.find((x) => x.id === id)!;
    return this.task(id, { evidence: [...t.evidence, { ...e, addedBy: "u1", addedAt: "2026-09-28T10:00:00Z" }] });
  }
  async resolveTask(id: string, verdicts: Record<string, string>, note: string) {
    this.log("resolveTask", id, verdicts, note);
    return this.task(id, { status: "resolved" });
  }
  async discardTask(id: string, note: string) {
    this.log("discardTask", id, note);
    return this.task(id, { status: "discarded" });
  }

  rebuttals: PendingRebuttal[] = [
    { id: "r1", outletId: "ddv", submittedBy: "rep", target: { type: "credibility", topic: "tarifas de gas" }, statement: "Nuestra nota citaba la resolución oficial; pedimos revisar la dimensión de precisión.", evidenceUrls: ["https://ddv.example/nota"], status: "submitted", createdAt: "2026-09-26T10:00:00Z" },
  ];
  async pendingRebuttals() {
    return this.rebuttals;
  }
  async resolveRebuttal(id: string, decision: string, note: string) {
    this.log("resolveRebuttal", id, decision, note);
  }

  events: PublicEvent[] = [];
  async hostedEvents() {
    return this.events;
  }
  async createEvent(input: { title: string; startsAt: string; endsAt: string }) {
    this.log("createEvent", input);
    this.events = [{ id: "ev1", code: "ABC234", title: input.title, host: "Sin Humo", startsAt: input.startsAt, endsAt: input.endsAt, status: "scheduled", watching: 0, pinned: [] }, ...this.events];
    return { id: "ev1", event: { code: "ABC234" } };
  }
  async closeEvent(id: string) {
    this.log("closeEvent", id);
  }
  async factCheck(eventId: string, text: string) {
    this.log("factCheck", eventId, text);
  }
  async muteAuthor(messageId: string, minutes: number, removeMessage: boolean) {
    this.log("muteAuthor", messageId, minutes, removeMessage);
    return { until: "2026-09-28T22:00:00Z" };
  }

  restrictionList: Restriction[] = [
    { id: "x1", target: { kind: "ip", value: "203.0.113.9" }, level: "block", reason: "Muchas altas seguidas", createdAt: "2026-09-28T09:00:00Z", until: "2099-01-01T00:00:00Z", createdBy: "sistema:abuso", automatic: true },
  ];
  async restrictions() {
    return this.restrictionList;
  }
  async restrict(input: NewRestriction) {
    this.log("restrict", input);
    return { id: "x2", target: { kind: input.kind, value: input.value }, level: input.level, reason: input.reason, createdAt: "2026-09-28T10:00:00Z", createdBy: "u1", automatic: false };
  }
  async liftRestriction(id: string) {
    this.log("liftRestriction", id);
    return { ...this.restrictionList.find((r) => r.id === id)!, liftedAt: "2026-09-28T10:00:00Z", liftedBy: "u1" };
  }

  async businessStats(from: string, to: string) {
    return {
      period: { from, to }, currency: "ARS", mrr: 1_500_000, mrrAtStart: 1_200_000, payingSubjects: 120, payingAtStart: 100, newPaying: 25, churned: 5,
      churnRate: 0.05, arpu: 12_500, registrations: 900, activations: 540, activationRate: 0.6, conversionRate: 0.028, trialing: 12,
      byPlan: [{ planId: "personal", subjects: 100, mrr: 499_000 }, { planId: "profesional", subjects: 20, mrr: 299_800 }],
    };
  }

  params: Parameter[] = [{ key: "events.slow_mode_seconds", description: "Modo lento en los eventos", type: "number", default: 10, min: 0, max: 600, unit: "s", value: 10 }];
  async parameters() {
    return this.params;
  }
  async setParameter(key: string, value: unknown, reason: string) {
    this.log("setParameter", key, value, reason);
    this.params = this.params.map((p) => (p.key === key ? { ...p, value: value as number, changed: { value: value as number, version: 1, updatedAt: "2026-09-28T10:00:00Z", updatedBy: "u1", reason } } : p));
  }

  ruleList: BusinessRule[] = [];
  async rules() {
    return this.ruleList;
  }
  async saveRule(draft: RuleDraft) {
    this.log("saveRule", draft);
    const r: BusinessRule = { ...draft, id: "regla-1", version: 1, priority: draft.priority ?? 100, status: "draft", createdBy: "otra", createdAt: "2026-09-28T10:00:00Z" };
    this.ruleList = [r];
    return r;
  }
  async testRule(id: string, scenarios: RuleScenario[]) {
    this.log("testRule", id, scenarios);
    const res = { at: "2026-09-28T10:00:00Z", passed: true, results: scenarios.map((s) => ({ name: s.name, expected: s.expect, got: s.expect, ok: true })) };
    this.ruleList = this.ruleList.map((r) => (r.id === id ? { ...r, lastTest: res } : r));
    return res;
  }
  async approveRule(id: string) {
    this.log("approveRule", id);
    this.ruleList = this.ruleList.map((r) => (r.id === id ? { ...r, status: "active" as const } : r));
    return this.ruleList[0]!;
  }
  async archiveRule(id: string) {
    this.log("archiveRule", id);
  }
  async ruleHistory() {
    return this.ruleList;
  }

  couponList: Coupon[] = [];
  async coupons() {
    return this.couponList;
  }
  async createCoupon(input: NewCoupon) {
    this.log("createCoupon", input);
    const c: Coupon = { ...input, intervals: ["month", "year"], redemptions: 0, active: true };
    this.couponList = [c, ...this.couponList];
    return c;
  }
  async deactivateCoupon(code: string) {
    this.log("deactivateCoupon", code);
    this.couponList = this.couponList.map((c) => (c.code === code ? { ...c, active: false } : c));
  }

  flagList: FeatureFlag[] = [
    { key: "event_rooms", description: "Eventos en vivo", enabled: true, rolloutPercent: 100, allowUsers: [], allowOrgs: [], plans: [], countries: [], updatedAt: "1970-01-01T00:00:00.000Z", updatedBy: "sistema" },
  ];
  async flags() {
    return this.flagList;
  }
  async updateFlag(key: string, patch: FlagPatch) {
    this.log("updateFlag", key, patch);
    this.flagList = this.flagList.map((f) => (f.key === key ? { ...f, ...patch, updatedBy: "u1", updatedAt: "2026-09-28T10:00:00Z" } : f));
    return this.flagList.find((f) => f.key === key)!;
  }

  tree: AdminCategory[] = [
    {
      id: "economia", name: "Economía", order: 1, active: true, path: "Economía", children: [],
      topics: [
        { id: "gas", name: "tarifas de gas", categoryId: "economia", keywords: ["gas", "tarifa"], synonyms: ["gas natural"], sensitive: false, countries: [], active: true, updatedAt: "2026-09-01T10:00:00Z", updatedBy: "sistema" },
        { id: "yerba", name: "yerba mate", categoryId: "economia", keywords: ["yerba"], synonyms: [], sensitive: false, countries: ["AR"], active: false, updatedAt: "2026-09-01T10:00:00Z", updatedBy: "u1" },
      ],
    },
  ];
  async taxonomy() {
    return this.tree;
  }
  async saveTopic(draft: TopicDraft) {
    this.log("saveTopic", draft);
  }
  async saveCategory(draft: CategoryDraft) {
    this.log("saveCategory", draft);
  }

  qualityData: QualityOverview = {
    current: "reglas-v2",
    versions: [
      { id: "reglas-v2", engine: "rules", description: "Reglas con listas de 2026", status: "active", createdAt: "2026-08-01T10:00:00Z", lastEvaluation: { examples: 40, accuracy: 0.9, precision: 0.88, recall: 0.92, f1: 0.9, perType: { alarmism: { precision: 0.8, recall: 0.75, support: 8 } } } },
      { id: "llm-v1", engine: "llm", description: "Modelo de lenguaje", status: "candidate", createdAt: "2026-09-01T10:00:00Z", lastEvaluation: { examples: 40, accuracy: 0.93, precision: 0.91, recall: 0.95, f1: 0.93, perType: {} } },
    ],
    pendingReview: [{ id: "ex1", text: "Increíble oferta que cambia tu vida para siempre", expected: { isSmoke: true, types: ["marketing"] }, source: "feedback", reviewed: false, addedAt: "2026-09-27T10:00:00Z", note: "no me sirvió" }],
    reviewedExamples: 40,
    usefulness: { "reglas-v2": { total: 20, useful: 17, rate: 0.85 } },
  };
  async quality() {
    return this.qualityData;
  }
  async addExample(text: string, label: ExampleLabel, note?: string) {
    this.log("addExample", text, label, note);
    return { id: "ex2", text, expected: label, source: "curated" as const, reviewed: true, addedAt: "2026-09-28T10:00:00Z", note };
  }
  async reviewExample(id: string, label: ExampleLabel) {
    this.log("reviewExample", id, label);
    const ex = this.qualityData.pendingReview.find((x) => x.id === id)!;
    this.qualityData = { ...this.qualityData, pendingReview: this.qualityData.pendingReview.filter((x) => x.id !== id), reviewedExamples: this.qualityData.reviewedExamples + 1 };
    return { ...ex, expected: label, reviewed: true };
  }
  async evaluate() {
    this.log("evaluate");
    return { id: "run1", modelVersion: "reglas-v2", at: "2026-09-28T10:00:00Z", metrics: this.qualityData.versions[0]!.lastEvaluation!, failures: [{ exampleId: "ex9", expected: { isSmoke: true, types: ["alarmism" as const] }, got: { isSmoke: false, types: [], smokeIndex: 12 } }] };
  }
  async promote(versionId: string) {
    this.log("promote", versionId);
  }

  catalog: CatalogSources = { sources: [{ id: "pauta-nacional", label: "Pauta oficial nacional (datos abiertos)" }], csvUpload: true };
  report: ImportReport = { sourceId: "x", outlets: 1, owners: 0, ownership: 0, advertising: 0, feeds: 1, unmatched: ["Diario Fantasma"], rejected: [], warnings: ["Medio el-litoral: \"Santa Fé\" no es una región de Argentina."] };
  async catalogSources() {
    return this.catalog;
  }
  async importCatalog(sourceId: string) {
    this.log("importCatalog", sourceId);
    return { ...this.report, sourceId };
  }
  async importCsv(kind: CsvKind, text: string) {
    this.log("importCsv", kind, text);
    return { ...this.report, sourceId: `subida-${kind}` };
  }

  auditEntries: AuditEntry[] = Array.from({ length: 3 }, (_, i) => ({
    id: `a${i}`, at: `2026-09-2${8 - i}T10:00:00.000Z`, action: i === 0 ? "taxonomy.changed" : "ops.backup_accessed", actorId: "u1", target: i === 0 ? { type: "topic", id: "gas" } : undefined, data: i === 0 ? { kind: "topic", active: true } : {},
  }));
  async audit(filter: { from?: string; to?: string; action?: string }) {
    this.log("audit", filter);
    return this.auditEntries.filter((e) => (!filter.to || e.at <= filter.to) && (!filter.action || e.action === filter.action));
  }

  async costs(from: string, to: string) {
    this.log("costs", from, to);
    return {
      period: { from, to }, totalCostUsd: 12.5, totalRevenueUsd: 40,
      byProvider: { anthropic: 10, whatsapp: 2.5, "whisper-local": 0 },
      bySubject: [
        { subjectId: "u7", planId: "gratis", revenueUsd: 0, costUsd: 6, marginUsd: -6, costShare: null, overBudget: true },
        { subjectId: "org1", planId: "equipo", revenueUsd: 40, costUsd: 6.5, marginUsd: 33.5, costShare: 0.1625, overBudget: false },
      ],
    };
  }

  backupList: BackupManifest[] = [
    { id: "b1", key: "backups/2026/09/27/sinhumo-b1.shbk", kind: "daily", createdAt: "2026-09-27T03:00:00Z", engine: "postgres", environment: "production", collections: { users: 120, analyses: 3400 }, bytes: 2_400_000, sha256: "ab".repeat(32), verifiedAt: "2026-09-27T04:00:00Z", verification: { ok: true, detail: "3520 documentos restaurados sin diferencias." } },
  ];
  async backups() {
    return this.backupList;
  }
  async createBackup() {
    this.log("createBackup");
    const m: BackupManifest = { ...this.backupList[0]!, id: "b2", key: "backups/2026/09/28/sinhumo-b2.shbk", kind: "manual", createdAt: "2026-09-28T10:00:00Z", verifiedAt: undefined, verification: undefined };
    this.backupList = [m, ...this.backupList];
    return m;
  }
  async verifyBackup(key: string) {
    this.log("verifyBackup", key);
    const m = { ...this.backupList.find((b) => b.key === key)!, verifiedAt: "2026-09-28T11:00:00Z", verification: { ok: true, detail: "3520 documentos restaurados sin diferencias." } };
    this.backupList = this.backupList.map((b) => (b.key === key ? m : b));
    return m;
  }

  async uploadDocument(doc: NewOfficialDocument) {
    this.log("uploadDocument", doc);
    return { ...doc, id: "doc1" };
  }

  roleList: RoleInfo[] = [
    { id: "reader", name: "Lector", description: "Usa su plan.", scope: "organization" },
    { id: "fact_checker", name: "Verificador", description: "Verifica afirmaciones.", scope: "platform" },
    { id: "support_agent", name: "Soporte", description: "Atiende tickets.", scope: "platform" },
    { id: "outlet_rep", name: "Representante de medio", description: "Derecho a réplica.", scope: "platform" },
    { id: "platform_admin", name: "Administrador de la plataforma", description: "Todos los permisos.", scope: "platform" },
  ];
  people: AdminUser[] = [
    { id: "u-admin", name: "Ana Admin", status: "active", roleIds: ["reader", "platform_admin"], channels: [{ channel: "email", address: "ana@sinhumo.example", verified: true }], representsOutletIds: [], createdAt: "2026-01-01T10:00:00Z" },
    { id: "u-juan", name: "Juan Pérez", status: "active", roleIds: ["reader"], organization: { id: "org1", name: "Redacción QA" }, channels: [{ channel: "whatsapp", address: "+5491155554444", verified: true }, { channel: "email", address: "juan@correo.example", verified: true }], representsOutletIds: [], createdAt: "2026-05-01T10:00:00Z" },
    { id: "u-susp", name: "Cuenta spam", status: "suspended", roleIds: ["reader"], channels: [], representsOutletIds: [], suspension: { reason: "Spam en eventos", at: "2026-09-20T10:00:00Z", by: "u-admin" }, createdAt: "2026-09-01T10:00:00Z" },
  ];
  private person(id: string, patch: (u: AdminUser) => AdminUser) {
    this.people = this.people.map((u) => (u.id === id ? patch(u) : u));
    return this.people.find((u) => u.id === id)!;
  }
  async roleCatalog() {
    return this.roleList;
  }
  async searchUsers(q: string, filter: UserListFilter) {
    this.log("searchUsers", q, filter);
    if (q.trim()) return this.people.filter((u) => u.id === q.trim() || u.channels.some((c) => c.address === q.trim().toLowerCase()));
    return filter === "suspended" ? this.people.filter((u) => u.status === "suspended") : this.people.filter((u) => u.roleIds.some((r) => r !== "reader"));
  }
  async addUserRole(userId: string, roleId: string) {
    this.log("addUserRole", userId, roleId);
    return this.person(userId, (u) => ({ ...u, roleIds: [...u.roleIds, roleId] }));
  }
  async removeUserRole(userId: string, roleId: string) {
    this.log("removeUserRole", userId, roleId);
    return this.person(userId, (u) => ({ ...u, roleIds: u.roleIds.filter((r) => r !== roleId) }));
  }
  async suspendUser(userId: string, reason: string) {
    this.log("suspendUser", userId, reason);
    return this.person(userId, (u) => ({ ...u, status: "suspended", suspension: { reason, at: "2026-09-28T10:00:00Z", by: "u-admin" } }));
  }
  async reactivateUser(userId: string, reason: string) {
    this.log("reactivateUser", userId, reason);
    return this.person(userId, (u) => ({ ...u, status: "active", suspension: undefined }));
  }
  async addRepresentedOutlet(userId: string, outletId: string) {
    this.log("addRepresentedOutlet", userId, outletId);
    return this.person(userId, (u) => ({ ...u, representsOutletIds: [...u.representsOutletIds, outletId], roleIds: [...new Set([...u.roleIds, "outlet_rep"])] }));
  }
  async removeRepresentedOutlet(userId: string, outletId: string) {
    this.log("removeRepresentedOutlet", userId, outletId);
    return this.person(userId, (u) => {
      const outlets = u.representsOutletIds.filter((o) => o !== outletId);
      return { ...u, representsOutletIds: outlets, roleIds: outlets.length ? u.roleIds : u.roleIds.filter((r) => r !== "outlet_rep") };
    });
  }

  records: Record<string, OutletRecord> = {};
  private record(id: string): OutletRecord {
    return (this.records[id] ??= {
      outlet: { id, name: id === "ddv" ? "Diario del Valle" : id, url: `https://${id}.example`, kind: "newspaper", region: { country: "AR", province: "Río Negro" }, aliases: ["DDV"] },
      feeds: [{ id: `feed:${id}`, outletId: id, url: `https://${id}.example/rss`, active: true, lastFetchedAt: "2026-09-28T09:00:00Z", lastError: "HTTP 503" }],
      ownership: [{ ownerId: "grupo-norte", ownerName: "Grupo Norte", since: "2015-01-01T00:00:00Z", source: "Registro de medios" }],
    });
  }
  async outletRecord(id: string) {
    return this.record(id);
  }
  async saveOutlet(draft: OutletDraft) {
    this.log("saveOutlet", draft);
    const id = draft.id ?? draft.name.toLowerCase().replace(/\W+/g, "-");
    const outlet: AdminOutlet = { ...draft, id };
    this.records[id] = { ...(this.records[id] ?? { feeds: [], ownership: [] }), outlet };
    return outlet;
  }
  async addOutletFeed(outletId: string, url: string) {
    this.log("addOutletFeed", outletId, url);
    const feed: OutletFeed = { id: `feed:${outletId}:2`, outletId, url, active: true };
    this.record(outletId).feeds.push(feed);
    return feed;
  }
  async setOutletFeedActive(outletId: string, feedId: string, active: boolean) {
    this.log("setOutletFeedActive", outletId, feedId, active);
    const r = this.record(outletId);
    r.feeds = r.feeds.map((f) => (f.id === feedId ? { ...f, active } : f));
    return r.feeds.find((f) => f.id === feedId)!;
  }

  async publishCorrection(input: NewCorrection) {
    this.log("publishCorrection", input);
    return { id: "c9" };
  }

  planData: PlanCatalog = {
    features: [
      { id: "smoke_analysis", label: "Detector de humo" },
      { id: "alerts", label: "Alertas" },
      { id: "webhooks", label: "Webhooks" },
    ],
    plans: [
      {
        id: "personal", name: "Personal", description: "Para una persona", audience: "individual", tier: 1, liveSubscriptions: 12,
        price: { amount: 4990, currency: "ARS", interval: "month" }, yearlyPrice: { amount: 49900, currency: "ARS", interval: "year" },
        features: ["smoke_analysis", "alerts"],
        limits: { analysesPerDay: 50, comparisonsPerMonth: 20, maxSourcesPerComparison: 5, maxIncludeUrls: 5, maxSavedRuleSets: 3, maxAlerts: 5, maxSourceConnections: 1, seats: 1 },
      },
    ],
  };
  async planCatalog() {
    return this.planData;
  }
  async updatePlan(id: string, patch: PlanPatch) {
    this.log("updatePlan", id, patch);
    const p = this.planData.plans.find((x) => x.id === id)!;
    const next: AdminPlan = {
      ...p, name: patch.name, description: patch.description, features: patch.features, limits: patch.limits,
      price: p.price && { ...p.price, amount: patch.monthlyAmount! }, customized: { at: "2026-09-28T10:00:00Z", by: "u1" },
    };
    this.planData = { ...this.planData, plans: this.planData.plans.map((x) => (x.id === id ? next : x)) };
    return next;
  }
  async createPlan(input: NewPlan) {
    this.log("createPlan", input);
    const base = this.planData.plans.find((p) => p.id === input.basedOn)!;
    const plan: AdminPlan = {
      ...base, id: input.name.toLowerCase().replace(/\W+/g, "-"), name: input.name, description: input.description, tier: input.tier, liveSubscriptions: 0,
      price: { amount: input.monthlyAmount, currency: "ARS", interval: "month" }, yearlyPrice: undefined, customized: { at: "2026-09-29T10:00:00Z", by: "u1" },
    };
    this.planData = { ...this.planData, plans: [...this.planData.plans, plan] };
    return plan;
  }
  async setPlanForSale(id: string, forSale: boolean) {
    this.log("setPlanForSale", id, forSale);
    const p = { ...this.planData.plans.find((x) => x.id === id)!, forSale: forSale ? undefined : false };
    this.planData = { ...this.planData, plans: this.planData.plans.map((x) => (x.id === id ? p : x)) };
    return p;
  }
  async resetPlan(id: string) {
    this.log("resetPlan", id);
    return { ...this.planData.plans.find((x) => x.id === id)!, customized: undefined };
  }

  async publishLegal(docId: "terms" | "privacy", input: NewLegalVersion) {
    this.log("publishLegal", docId, input);
    return { version: "2026-09-29" };
  }
}

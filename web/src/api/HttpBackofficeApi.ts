import type { BackofficeApi } from "./BackofficeApi";
import type {
  AgentTicket,
  Coupon,
  NewCoupon,
  BusinessRule,
  BusinessStats,
  FeatureFlag,
  FlagPatch,
  NewEvent,
  NewEvidence,
  NewRestriction,
  Parameter,
  ParameterValue,
  PendingRebuttal,
  RebuttalDecision,
  Restriction,
  RuleDraft,
  RuleScenario,
  RuleTestResult,
  TicketStatus,
  VerdictStatus,
  VerificationTask,
  AdminCategory,
  AuditEntry,
  BackupManifest,
  CatalogSources,
  CategoryDraft,
  CostReport,
  CsvKind,
  EvaluationRun,
  ExampleLabel,
  ImportReport,
  LabeledExample,
  NewOfficialDocument,
  OfficialDocument,
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
  PlanMigration,
  NewPlanMigration,
  PlatformProfile,
  SetupOverview,
  FillLegalResult,
  CatalogDirectoryEntry,
  DirectoryCheck,
} from "./backofficeTypes";
import { jsonRequest, type Fetch } from "./http";
import type { PublicEvent } from "./types";

const enc = encodeURIComponent;

/** Adaptador HTTP del backoffice (misma sesión por cookie que la web de personas). */
export class HttpBackofficeApi implements BackofficeApi {
  constructor(
    private readonly base = "",
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return jsonRequest<T>(this.fetchFn, this.base, method, path, body);
  }

  supportQueue() {
    return this.request<AgentTicket[]>("GET", "/v1/support/queue");
  }
  replyAsAgent(ticketId: string, text: string, opts: { internal?: boolean; status?: TicketStatus }) {
    return this.request<AgentTicket>("POST", `/v1/support/tickets/${enc(ticketId)}/reply`, { text, ...opts });
  }

  verificationTasks() {
    return this.request<VerificationTask[]>("GET", "/v1/verification/tasks");
  }
  takeTask(id: string) {
    return this.request<VerificationTask>("POST", `/v1/verification/tasks/${enc(id)}/take`);
  }
  suggestEvidence(id: string) {
    return this.request<VerificationTask>("POST", `/v1/verification/tasks/${enc(id)}/suggest`);
  }
  addEvidence(id: string, evidence: NewEvidence) {
    return this.request<VerificationTask>("POST", `/v1/verification/tasks/${enc(id)}/evidence`, evidence);
  }
  resolveTask(id: string, verdicts: Record<string, VerdictStatus>, note: string) {
    return this.request<VerificationTask>("POST", `/v1/verification/tasks/${enc(id)}/resolve`, { verdicts, note });
  }
  discardTask(id: string, note: string) {
    return this.request<VerificationTask>("POST", `/v1/verification/tasks/${enc(id)}/discard`, { note });
  }

  pendingRebuttals() {
    return this.request<PendingRebuttal[]>("GET", "/v1/rebuttals");
  }
  async resolveRebuttal(id: string, decision: RebuttalDecision, note: string) {
    await this.request("POST", `/v1/rebuttals/${enc(id)}/resolve`, { decision, note });
  }

  hostedEvents() {
    return this.request<PublicEvent[]>("GET", "/v1/events");
  }
  createEvent(input: NewEvent) {
    return this.request<{ id: string; event?: { code: string } }>("POST", "/v1/events", input);
  }
  async closeEvent(id: string) {
    await this.request("POST", `/v1/events/${enc(id)}/close`);
  }
  async factCheck(eventId: string, text: string) {
    await this.request("POST", `/v1/events/${enc(eventId)}/factcheck`, { text });
  }
  muteAuthor(messageId: string, minutes: number, removeMessage: boolean) {
    // La sala sale del mensaje: el id de la ruta no se usa.
    return this.request<{ until: string }>("POST", `/v1/events/-/mute`, { messageId, minutes, remove: removeMessage });
  }

  restrictions() {
    return this.request<Restriction[]>("GET", "/v1/abuse/restrictions?limit=200");
  }
  restrict(input: NewRestriction) {
    return this.request<Restriction>("POST", "/v1/abuse/restrictions", input);
  }
  liftRestriction(id: string) {
    return this.request<Restriction>("POST", `/v1/abuse/restrictions/${enc(id)}/lift`);
  }

  businessStats(from: string, to: string) {
    return this.request<BusinessStats>("GET", `/v1/stats/business?from=${enc(from)}&to=${enc(to)}`);
  }

  parameters() {
    return this.request<Parameter[]>("GET", "/v1/parameters");
  }
  async setParameter(key: string, value: ParameterValue, reason: string) {
    await this.request("PUT", `/v1/parameters/${enc(key)}`, { value, reason });
  }
  rules() {
    return this.request<BusinessRule[]>("GET", "/v1/business-rules");
  }
  saveRule(draft: RuleDraft) {
    return this.request<BusinessRule>("POST", "/v1/business-rules", draft);
  }
  testRule(id: string, scenarios: RuleScenario[]) {
    return this.request<RuleTestResult>("POST", `/v1/business-rules/${enc(id)}/test`, { scenarios });
  }
  approveRule(id: string) {
    return this.request<BusinessRule>("POST", `/v1/business-rules/${enc(id)}/approve`);
  }
  async archiveRule(id: string) {
    await this.request("POST", `/v1/business-rules/${enc(id)}/archive`);
  }
  ruleHistory(id: string) {
    return this.request<BusinessRule[]>("GET", `/v1/business-rules/${enc(id)}/history`);
  }

  coupons() {
    return this.request<Coupon[]>("GET", "/v1/coupons");
  }
  createCoupon(input: NewCoupon) {
    return this.request<Coupon>("POST", "/v1/coupons", input);
  }
  async deactivateCoupon(code: string) {
    await this.request("POST", `/v1/coupons/${enc(code)}/deactivate`);
  }

  flags() {
    return this.request<FeatureFlag[]>("GET", "/v1/flags");
  }
  updateFlag(key: string, patch: FlagPatch) {
    return this.request<FeatureFlag>("PATCH", `/v1/flags/${enc(key)}`, patch);
  }

  taxonomy() {
    return this.request<AdminCategory[]>("GET", "/v1/taxonomy");
  }
  async saveTopic(draft: TopicDraft) {
    await this.request("POST", "/v1/taxonomy/topics", draft);
  }
  async saveCategory(draft: CategoryDraft) {
    await this.request("POST", "/v1/taxonomy/categories", draft);
  }

  quality() {
    return this.request<QualityOverview>("GET", "/v1/quality");
  }
  addExample(text: string, label: ExampleLabel, note?: string) {
    return this.request<LabeledExample>("POST", "/v1/quality/examples", { text, ...label, note });
  }
  reviewExample(id: string, label: ExampleLabel) {
    return this.request<LabeledExample>("POST", `/v1/quality/examples/${enc(id)}/review`, label);
  }
  evaluate() {
    return this.request<EvaluationRun>("POST", "/v1/quality/evaluate");
  }
  async promote(versionId: string) {
    await this.request("POST", "/v1/quality/promote", { versionId });
  }

  catalogSources() {
    return this.request<CatalogSources>("GET", "/v1/catalog/sources");
  }
  importCatalog(sourceId: string) {
    return this.request<ImportReport>("POST", "/v1/catalog/import", { sourceId });
  }
  importCsv(kind: CsvKind, text: string) {
    return this.request<ImportReport>("POST", "/v1/catalog/import-csv", { kind, text });
  }

  audit(filter: { from?: string; to?: string; action?: string }) {
    const q = new URLSearchParams(Object.entries(filter).filter((e): e is [string, string] => !!e[1]));
    return this.request<AuditEntry[]>("GET", `/v1/audit${q.toString() ? `?${q}` : ""}`);
  }

  costs(from: string, to: string) {
    return this.request<CostReport>("GET", `/v1/costs?from=${enc(from)}&to=${enc(to)}`);
  }

  backups() {
    return this.request<BackupManifest[]>("GET", "/v1/ops/backups");
  }
  createBackup() {
    return this.request<BackupManifest>("POST", "/v1/ops/backups");
  }
  verifyBackup(key: string) {
    return this.request<BackupManifest>("POST", "/v1/ops/backups/verify", { key });
  }

  uploadDocument(doc: NewOfficialDocument) {
    return this.request<OfficialDocument>("POST", "/v1/verification/documents", doc);
  }

  roleCatalog() {
    return this.request<RoleInfo[]>("GET", "/v1/admin/roles");
  }
  searchUsers(q: string, filter: UserListFilter) {
    return this.request<AdminUser[]>("GET", q.trim() ? `/v1/admin/users?q=${enc(q.trim())}` : `/v1/admin/users?filter=${filter}`);
  }
  private userAction(userId: string, action: string, body: unknown) {
    return this.request<AdminUser>("POST", `/v1/admin/users/${enc(userId)}/${action}`, body);
  }
  addUserRole(userId: string, roleId: string) {
    return this.userAction(userId, "roles/add", { roleId });
  }
  removeUserRole(userId: string, roleId: string) {
    return this.userAction(userId, "roles/remove", { roleId });
  }
  suspendUser(userId: string, reason: string) {
    return this.userAction(userId, "suspend", { reason });
  }
  reactivateUser(userId: string, reason: string) {
    return this.userAction(userId, "reactivate", { reason });
  }
  addRepresentedOutlet(userId: string, outletId: string) {
    return this.userAction(userId, "outlets/add", { outletId });
  }
  removeRepresentedOutlet(userId: string, outletId: string) {
    return this.userAction(userId, "outlets/remove", { outletId });
  }

  outletRecord(id: string) {
    return this.request<OutletRecord>("GET", `/v1/catalog/outlets/${enc(id)}`);
  }
  saveOutlet(draft: OutletDraft) {
    return this.request<AdminOutlet>("POST", "/v1/catalog/outlets", draft);
  }
  addOutletFeed(outletId: string, url: string) {
    return this.request<OutletFeed>("POST", `/v1/catalog/outlets/${enc(outletId)}/feeds`, { url });
  }
  setOutletFeedActive(outletId: string, feedId: string, active: boolean) {
    return this.request<OutletFeed>("POST", `/v1/catalog/outlets/${enc(outletId)}/feeds/${enc(feedId)}/${active ? "activate" : "deactivate"}`);
  }

  publishCorrection(input: NewCorrection) {
    return this.request<{ id: string }>("POST", "/v1/corrections", input);
  }

  planCatalog() {
    return this.request<PlanCatalog>("GET", "/v1/admin/plans");
  }
  updatePlan(id: string, patch: PlanPatch) {
    return this.request<AdminPlan>("POST", `/v1/admin/plans/${enc(id)}`, patch);
  }
  createPlan(input: NewPlan) {
    return this.request<AdminPlan>("POST", "/v1/admin/plans", input);
  }
  planMigrations() {
    return this.request<PlanMigration[]>("GET", "/v1/admin/plan-migrations");
  }
  async migrationNotice(fromPlanId: string, toPlanId: string) {
    return (await this.request<{ days: number }>("GET", `/v1/admin/plan-migrations/notice?from=${enc(fromPlanId)}&to=${enc(toPlanId)}`)).days;
  }
  scheduleMigration(input: NewPlanMigration) {
    return this.request<PlanMigration>("POST", "/v1/admin/plan-migrations", input);
  }
  cancelMigration(id: string) {
    return this.request<PlanMigration>("POST", `/v1/admin/plan-migrations/${enc(id)}/cancel`);
  }
  setPlanForSale(id: string, forSale: boolean) {
    return this.request<AdminPlan>("POST", `/v1/admin/plans/${enc(id)}/for-sale`, { forSale });
  }
  resetPlan(id: string) {
    return this.request<AdminPlan>("POST", `/v1/admin/plans/${enc(id)}/reset`);
  }

  publishLegal(docId: "terms" | "privacy", input: NewLegalVersion) {
    return this.request<{ version: string }>("POST", `/v1/admin/legal/${docId}`, input);
  }

  setup() {
    return this.request<SetupOverview>("GET", "/v1/admin/setup");
  }
  saveSetupProfile(input: PlatformProfile) {
    return this.request<PlatformProfile>("PUT", "/v1/admin/setup/profile", input);
  }
  fillLegal() {
    return this.request<FillLegalResult>("POST", "/v1/admin/setup/fill-legal");
  }

  catalogDirectory() {
    return this.request<CatalogDirectoryEntry[]>("GET", "/v1/catalog/directory");
  }
  importDirectory(ids: string[]) {
    return this.request<{ outlets: number; feeds: number }>("POST", "/v1/catalog/directory/import", { ids });
  }
  verifyDirectory() {
    return this.request<DirectoryCheck[]>("POST", "/v1/catalog/directory/verify");
  }
}

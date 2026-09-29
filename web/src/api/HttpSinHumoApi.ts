import { ApiError } from "./ApiError";
import { jsonRequest, type Fetch } from "./http";
import type { SinHumoApi } from "./SinHumoApi";
import type {
  Analysis,
  AnalysisSummary,
  AuthOptions,
  CategoryNode,
  Checkout,
  Comparison,
  CredibilityReport,
  Me,
  Outlet,
  Preferences,
  PublicPlan,
  Quote,
  Topic,
  Ticket,
  TicketCategory,
  EvidenceSnapshot,
  EvidenceVerification,
  PublicEvent,
  RoomEvent,
  AlertRule,
  AlertTrigger,
  ApiKey,
  ApiKeyList,
  LearningProgress,
  OriginTrace,
  QuizQuestion,
  QuizResult,
  TimelinePoint,
  TeamRoom,
  TeamRoomDetails,
  InvitationPreview,
  OrganizationOverview,
  DeliveryResult,
  MyReview,
  RatingSummary,
  ReviewTarget,
  Webhook,
  WebhookList,
  MediaCheckReport,
  CirculatingNarrative,
  ObservatoryReport,
  OpenDataset,
  OutletProfile,
  PublicCorrection,
  PublicRebuttal,
  RuleSetList,
  SourceConnection,
  SourceList,
  UrlRules,
  UsagePanel,
  ExportFormat,
  ReportSchedule,
  Campaign,
  CampaignReport,
  ClassroomReport,
  ClassroomSummary,
  ReplyDraft,
} from "./types";


/**
 * Implementación con HTTP (adaptador). La sesión es una cookie HttpOnly del mismo origen:
 * el navegador la manda sola y el código de la web nunca la ve.
 */
export class HttpSinHumoApi implements SinHumoApi {
  constructor(
    private readonly base = "",
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return jsonRequest<T>(this.fetchFn, this.base, method, path, body);
  }

  authOptions() {
    return this.request<AuthOptions>("GET", "/public/auth-options");
  }

  async requestMagicLink(email: string, captchaToken?: string, next?: string) {
    await this.request("POST", "/auth/magic-link", { email, captchaToken, ...(next && next !== "/" ? { next } : {}) });
  }

  async loginWithPassword(email: string, password: string, captchaToken?: string) {
    await this.request("POST", "/auth/login", { email, password, captchaToken });
  }

  async logout(everywhere = false) {
    await this.request("POST", everywhere ? "/auth/logout-all" : "/auth/logout");
  }

  async me(): Promise<Me | undefined> {
    try {
      return await this.request<Me>("GET", "/v1/me");
    } catch (e) {
      if (e instanceof ApiError && e.needsLogin) return undefined;
      throw e;
    }
  }

  analyze(text: string) {
    return this.request<Analysis>("POST", "/v1/analyze", { text });
  }

  history(limit = 30) {
    return this.request<AnalysisSummary[]>("GET", `/v1/me/analyses?limit=${limit}`);
  }

  analysis(id: string) {
    return this.request<Analysis>("GET", `/v1/me/analyses/${encodeURIComponent(id)}`);
  }

  async feedback(analysisId: string, useful: boolean, reason?: string, comment?: string) {
    await this.request("POST", "/v1/feedback", { analysisId, useful, reason, comment });
  }

  compare(input: { topic: string; from: string; to: string; include?: string[] }) {
    return this.request<Comparison>("POST", "/v1/compare", {
      topic: input.topic,
      from: input.from,
      to: input.to,
      ...(input.include?.length ? { urlRules: { include: input.include } } : {}),
    });
  }

  credibility(input: { outletId: string; topic: string; from: string; to: string }) {
    return this.request<CredibilityReport>("POST", "/v1/credibility", input);
  }

  credibilityTimeline(input: { outletId: string; topic: string; from: string; to: string; windows: number }) {
    return this.request<TimelinePoint[]>("POST", "/v1/credibility/timeline", input);
  }

  traceOrigin(url: string, topic?: string) {
    return this.request<OriginTrace>("POST", "/v1/origin", { url, ...(topic ? { topic } : {}) });
  }

  alerts() {
    return this.request<AlertRule[]>("GET", "/v1/alerts");
  }

  createAlert(input: { topic: string; trigger: AlertTrigger; channel: string; outletId?: string }) {
    return this.request<AlertRule>("POST", "/v1/alerts", input);
  }

  async deactivateAlert(id: string) {
    await this.request("POST", `/v1/alerts/${encodeURIComponent(id)}/deactivate`);
  }

  apiKeys() {
    return this.request<ApiKeyList>("GET", "/v1/api-keys");
  }

  createApiKey(name: string, scopes: string[]) {
    return this.request<{ plaintext: string; key: ApiKey }>("POST", "/v1/api-keys", { name, scopes });
  }

  async revokeApiKey(id: string) {
    await this.request("POST", `/v1/api-keys/${encodeURIComponent(id)}/revoke`);
  }

  learningNext() {
    return this.request<QuizQuestion>("POST", "/v1/learning/next");
  }

  learningAnswer(isSmoke: boolean) {
    return this.request<QuizResult>("POST", "/v1/learning/answer", { isSmoke });
  }

  learningProgress() {
    return this.request<LearningProgress>("GET", "/v1/learning/progress");
  }

  async joinClassroom(code: string, alias: string) {
    await this.request("POST", "/v1/classrooms/join", { code, alias });
  }

  observatory(month: string) {
    return this.request<ObservatoryReport>("GET", `/public/observatory?month=${encodeURIComponent(month)}`);
  }

  narratives(days: number) {
    return this.request<CirculatingNarrative[]>("GET", `/public/narratives?days=${days}`);
  }

  outletProfile(id: string) {
    return this.request<OutletProfile>("GET", `/public/outlets/${encodeURIComponent(id)}`);
  }

  corrections() {
    return this.request<PublicCorrection[]>("GET", "/public/corrections");
  }

  datasets() {
    return this.request<OpenDataset[]>("GET", "/public/datasets");
  }

  datasetUrl(id: string, format: "csv" | "json") {
    return `${this.base}/public/datasets/${encodeURIComponent(id)}.${format}`;
  }

  topics() {
    return this.request<CategoryNode[]>("GET", "/public/topics");
  }

  outlets() {
    return this.request<Outlet[]>("GET", "/public/outlets");
  }

  plans() {
    return this.request<PublicPlan[]>("GET", "/public/plans");
  }

  preferences() {
    return this.request<Preferences>("GET", "/v1/me/preferences");
  }

  updatePreferences(values: Partial<Omit<Preferences, "source" | "followedTopics">>) {
    return this.request<Preferences>("PATCH", "/v1/me/preferences", values);
  }

  follow(topic: string) {
    return this.request<Topic>("POST", "/v1/me/preferences/follow", { topic });
  }

  unfollow(topic: string) {
    return this.request<Topic>("POST", "/v1/me/preferences/unfollow", { topic });
  }

  quote(planId: string, interval: "month" | "year", coupon?: string) {
    const q = new URLSearchParams({ planId, interval, ...(coupon ? { coupon } : {}) });
    return this.request<Quote>("GET", `/v1/quote?${q}`);
  }

  checkout(planId: string, interval: "month" | "year", couponCode?: string) {
    return this.request<Checkout>("POST", "/v1/checkout", { planId, interval, couponCode });
  }

  async cancelSubscription() {
    await this.request("POST", "/v1/subscription/cancel");
  }

  async resumeSubscription() {
    await this.request("POST", "/v1/subscription/resume");
  }

  async acceptLegal(docId: string, version: string) {
    await this.request("POST", "/v1/legal/accept", { docId, version });
  }

  async deleteAccount(confirmation: string) {
    await this.request("POST", "/v1/me/delete", { confirmation });
  }

  myDataUrl() {
    return `${this.base}/v1/me/data`;
  }

  tickets() {
    return this.request<Ticket[]>("GET", "/v1/support/tickets");
  }

  openTicket(input: { text: string; subject?: string; category?: TicketCategory }) {
    return this.request<Ticket>("POST", "/v1/support/tickets", input);
  }

  replyTicket(id: string, text: string) {
    return this.request<Ticket>("POST", `/v1/support/tickets/${encodeURIComponent(id)}/messages`, { text });
  }

  async rateTicket(id: string, score: number) {
    await this.request("POST", `/v1/support/tickets/${encodeURIComponent(id)}/rate`, { score });
  }

  evidence() {
    return this.request<EvidenceSnapshot[]>("GET", "/v1/evidence?limit=100");
  }

  evidenceHistory(url: string) {
    return this.request<EvidenceSnapshot[]>("GET", `/v1/evidence?url=${encodeURIComponent(url)}`);
  }

  capture(url: string, monitor: boolean) {
    return this.request<EvidenceSnapshot>("POST", "/v1/evidence", { url, monitor });
  }

  verifyEvidence(id: string) {
    return this.request<EvidenceVerification>("GET", `/v1/evidence/${encodeURIComponent(id)}/verify`);
  }

  evidenceFileUrl(id: string, kind: "raw" | "text") {
    return `${this.base}/v1/evidence/${encodeURIComponent(id)}/content?kind=${kind}`;
  }

  events() {
    return this.request<PublicEvent[]>("GET", "/public/events");
  }

  event(code: string) {
    return this.request<PublicEvent>("GET", `/public/events/${encodeURIComponent(code)}`);
  }

  /** Server-Sent Events: el navegador reconecta solo si se corta. */
  watchEvent(code: string, onEvent: (e: RoomEvent) => void, onError?: () => void) {
    const source = new EventSource(`${this.base}/public/events/${encodeURIComponent(code)}/stream`);
    source.onmessage = (m) => onEvent(JSON.parse(m.data as string) as RoomEvent);
    if (onError) source.onerror = onError;
    return () => source.close();
  }

  async postToRoom(roomId: string, text: string, kind?: "verificacion") {
    await this.request("POST", `/v1/rooms/${encodeURIComponent(roomId)}/messages`, { text, ...(kind ? { kind } : {}) });
  }

  checkMedia(file: File) {
    return jsonRequest<MediaCheckReport>(this.fetchFn, this.base, "POST", "/v1/media/check", undefined, file);
  }

  webhooks() {
    return this.request<WebhookList>("GET", "/v1/webhooks");
  }

  createWebhook(url: string, events: string[]) {
    return this.request<{ webhook: Webhook; signingSecret: string }>("POST", "/v1/webhooks", { url, events });
  }

  testWebhook(id: string) {
    return this.request<DeliveryResult>("POST", `/v1/webhooks/${encodeURIComponent(id)}/test`);
  }

  async removeWebhook(id: string) {
    await this.request("POST", `/v1/webhooks/${encodeURIComponent(id)}/remove`);
  }

  async myReview(target: ReviewTarget) {
    // Sin calificación todavía, el servidor responde null.
    const r = await this.request<MyReview | null>("GET", `/v1/reviews/mine?type=${target.type}&id=${encodeURIComponent(target.id)}`);
    return r && typeof r === "object" && "status" in r ? r : null;
  }

  review(target: ReviewTarget, rating: number | null, text?: string) {
    return this.request<MyReview>("POST", "/v1/reviews", { target, rating, ...(text ? { text } : {}) });
  }

  reviewSummary(target: ReviewTarget) {
    return this.request<RatingSummary>("GET", `/v1/reviews/summary?type=${target.type}&id=${encodeURIComponent(target.id)}`);
  }

  sources() {
    return this.request<SourceList>("GET", "/v1/sources");
  }

  connectSource(input: { type: "rss" | "email"; name: string; config: Record<string, string>; secret?: string }) {
    return this.request<SourceConnection>("POST", "/v1/sources", input);
  }

  async disconnectSource(id: string) {
    await this.request("POST", `/v1/sources/${encodeURIComponent(id)}/disconnect`);
  }

  ruleSets() {
    return this.request<RuleSetList>("GET", "/v1/rules");
  }

  async saveRuleSet(input: { scope: "user" | "organization"; name: string; urlRules: UrlRules }) {
    await this.request("POST", "/v1/rules", input);
  }

  async deactivateRuleSet(id: string) {
    await this.request("POST", `/v1/rules/${encodeURIComponent(id)}/deactivate`);
  }

  myRebuttals() {
    return this.request<PublicRebuttal[]>("GET", "/v1/rebuttals/mine");
  }

  async submitRebuttal(input: { outletId: string; topic: string; statement: string; evidenceUrls: string[] }) {
    await this.request("POST", "/v1/rebuttals", { outletId: input.outletId, target: { type: "credibility", topic: input.topic }, statement: input.statement, evidenceUrls: input.evidenceUrls });
  }

  usagePanel(scope: "user" | "organization", from: string, to: string) {
    return this.request<UsagePanel>("GET", `/v1/stats/panel?${new URLSearchParams({ scope, from, to })}`);
  }

  exportUrl(kind: "usage_panel" | "analysis_history", format: ExportFormat, opts: { scope?: "user" | "organization"; from?: string; to?: string } = {}) {
    const q = new URLSearchParams({ kind, format, ...(opts.scope ? { scope: opts.scope } : {}), ...(opts.from ? { from: opts.from } : {}), ...(opts.to ? { to: opts.to } : {}) });
    return `${this.base}/v1/export?${q}`;
  }

  reportSchedules() {
    return this.request<ReportSchedule[]>("GET", "/v1/reports/schedules");
  }

  createReportSchedule(input: { name: string; kind: "usage_panel" | "analysis_history"; scope?: "user" | "organization"; format: ExportFormat; frequency: "weekly" | "monthly"; recipients: string[] }) {
    return this.request<ReportSchedule>("POST", "/v1/reports/schedules", input);
  }

  async deleteReportSchedule(id: string) {
    await this.request("DELETE", `/v1/reports/schedules/${encodeURIComponent(id)}`);
  }

  classrooms() {
    return this.request<ClassroomSummary[]>("GET", "/v1/classrooms");
  }

  async createClassroom(name: string, showLeaderboard: boolean) {
    await this.request("POST", "/v1/classrooms", { name, showLeaderboard });
  }

  classroomReport(id: string) {
    return this.request<ClassroomReport>("GET", `/v1/classrooms/${encodeURIComponent(id)}/report`);
  }

  async archiveClassroom(id: string) {
    await this.request("POST", `/v1/classrooms/${encodeURIComponent(id)}/archive`);
  }

  myReplies() {
    return this.request<ReplyDraft[]>("GET", "/v1/replies");
  }

  pendingReplies() {
    return this.request<ReplyDraft[]>("GET", "/v1/replies/pending");
  }

  reviewReply(id: string, approve: boolean) {
    return this.request<ReplyDraft>("POST", `/v1/replies/${encodeURIComponent(id)}/review`, { approve });
  }

  campaigns() {
    return this.request<{ campaigns: Campaign[]; channels: { id: string; label: string }[] }>("GET", "/v1/campaigns");
  }

  createCampaign(input: { claim: string; title: string; summary: string; links: { label: string; url: string }[]; channelIds: string[]; topic?: string; political: boolean }) {
    return this.request<Campaign>("POST", "/v1/campaigns", {
      claim: input.claim, channelIds: input.channelIds, topic: input.topic, political: input.political,
      message: { kind: "result", title: input.title, summary: input.summary, sections: [], links: input.links },
    });
  }

  reviewCampaign(id: string, approve: boolean, note: string) {
    return this.request<Campaign>("POST", `/v1/campaigns/${encodeURIComponent(id)}/review`, { approve, note });
  }

  launchCampaign(id: string) {
    return this.request<Campaign>("POST", `/v1/campaigns/${encodeURIComponent(id)}/launch`);
  }

  campaignReport(id: string) {
    return this.request<CampaignReport>("GET", `/v1/campaigns/${encodeURIComponent(id)}/report`);
  }

  async organization(): Promise<OrganizationOverview | undefined> {
    try {
      return await this.request<OrganizationOverview>("GET", "/v1/organization");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return undefined;
      throw e;
    }
  }

  createOrganization(name: string) {
    return this.request<OrganizationOverview>("POST", "/v1/organization", { name });
  }

  async inviteMember(email: string, roleId: string) {
    await this.request("POST", "/v1/organization/invitations", { email, roleId });
  }

  async revokeInvitation(id: string) {
    await this.request("POST", `/v1/organization/invitations/${encodeURIComponent(id)}/revoke`);
  }

  setMemberRole(memberId: string, roleId: string) {
    return this.request<OrganizationOverview>("PUT", `/v1/organization/members/${encodeURIComponent(memberId)}/role`, { roleId });
  }

  removeMember(memberId: string) {
    return this.request<OrganizationOverview>("POST", `/v1/organization/members/${encodeURIComponent(memberId)}/remove`);
  }

  async leaveOrganization() {
    await this.request("POST", "/v1/organization/leave");
  }

  invitation(token: string) {
    return this.request<InvitationPreview>("GET", `/public/invitations/${encodeURIComponent(token)}`);
  }

  joinOrganization(token: string) {
    return this.request<OrganizationOverview>("POST", "/v1/organization/join", { token });
  }

  rooms() {
    return this.request<TeamRoom[]>("GET", "/v1/rooms");
  }

  createRoom(input: { name: string; topic?: string; slowModeSeconds?: number }) {
    return this.request<TeamRoom>("POST", "/v1/rooms", input);
  }

  room(id: string) {
    return this.request<TeamRoomDetails>("GET", `/v1/rooms/${encodeURIComponent(id)}`);
  }

  async archiveRoom(id: string) {
    await this.request("POST", `/v1/rooms/${encodeURIComponent(id)}/archive`);
  }

  async deleteRoomMessage(messageId: string) {
    await this.request("POST", `/v1/rooms/messages/${encodeURIComponent(messageId)}/delete`);
  }

  /** Con la cookie de sesión (mismo origen): EventSource la manda sola. */
  watchRoom(id: string, onEvent: (e: RoomEvent) => void, onError?: () => void) {
    const source = new EventSource(`${this.base}/v1/rooms/${encodeURIComponent(id)}/events`);
    source.onmessage = (m) => onEvent(JSON.parse(m.data as string) as RoomEvent);
    if (onError) source.onerror = onError;
    return () => source.close();
  }
}

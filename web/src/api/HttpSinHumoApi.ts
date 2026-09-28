import { ApiError } from "./ApiError";
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
} from "./types";

type Fetch = typeof fetch;

/**
 * Implementación con HTTP (adaptador). La sesión es una cookie HttpOnly del mismo origen:
 * el navegador la manda sola y el código de la web nunca la ve.
 */
export class HttpSinHumoApi implements SinHumoApi {
  constructor(
    private readonly base = "",
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const retry = Number(res.headers.get("retry-after") ?? "");
      throw new ApiError(
        res.status,
        String(data.error ?? `Error ${res.status}`),
        data.code as string | undefined,
        data.upgradeHint as string | undefined,
        Number.isFinite(retry) && retry > 0 ? retry : undefined,
        data.captcha as ApiError["captcha"],
      );
    }
    return data as T;
  }

  authOptions() {
    return this.request<AuthOptions>("GET", "/public/auth-options");
  }

  async requestMagicLink(email: string, captchaToken?: string) {
    await this.request("POST", "/auth/magic-link", { email, captchaToken });
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

  async postToRoom(roomId: string, text: string) {
    await this.request("POST", `/v1/rooms/${encodeURIComponent(roomId)}/messages`, { text });
  }
}

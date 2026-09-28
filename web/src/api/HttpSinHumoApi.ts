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

  async acceptLegal(docId: string, version: string) {
    await this.request("POST", "/v1/legal/accept", { docId, version });
  }

  async deleteAccount(confirmation: string) {
    await this.request("POST", "/v1/me/delete", { confirmation });
  }

  myDataUrl() {
    return `${this.base}/v1/me/data`;
  }
}

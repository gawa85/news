import { ApiError } from "../api/ApiError";
import type { SinHumoApi } from "../api/SinHumoApi";
import type { Analysis, Me, Preferences } from "../api/types";

/** API falsa (misma interfaz que la real): las pantallas se prueban sin servidor. */
export class FakeApi implements SinHumoApi {
  calls: { method: string; args: unknown[] }[] = [];
  session: Me | undefined;
  analyzeResult: Analysis | ApiError = sampleAnalysis();
  prefs: Preferences = { followedTopics: [], responseFormat: "detailed", language: "es", quietHours: null, digest: "off", audioReplies: false, source: {} };

  constructor(session?: Me) {
    this.session = session;
  }

  private log(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }

  async authOptions() {
    return { providers: ["google"], captcha: null };
  }
  async requestMagicLink(email: string, captchaToken?: string) {
    this.log("requestMagicLink", email, captchaToken);
  }
  async loginWithPassword(email: string, password: string) {
    this.log("loginWithPassword", email, password);
    if (password !== "correcta") throw new ApiError(403, "Mail o contraseña incorrectos.", "no_permission");
    this.session = sampleMe();
  }
  async logout() {
    this.log("logout");
    this.session = undefined;
  }
  async me() {
    return this.session;
  }
  async analyze(text: string) {
    this.log("analyze", text);
    if (this.analyzeResult instanceof ApiError) throw this.analyzeResult;
    return this.analyzeResult;
  }
  async history() {
    return [{ id: "a1", at: "2026-09-28T12:00:00Z", sourceType: "message", excerpt: "Una cadena", smokeIndex: 80, findings: 3 }];
  }
  async analysis() {
    return sampleAnalysis();
  }
  async feedback(analysisId: string, useful: boolean, reason?: string) {
    this.log("feedback", analysisId, useful, reason);
  }
  async compare(): Promise<never> {
    throw new ApiError(429, "Llegaste al límite de comparaciones del mes.", "quota_exceeded", "Disponible en el plan Personal.");
  }
  async credibility(): Promise<never> {
    throw new Error("no usado");
  }
  async topics() {
    return [{ id: "c1", name: "Economía", path: "Economía", children: [], topics: [{ id: "t1", name: "tarifas de gas", synonyms: [] }] }];
  }
  async outlets() {
    return [{ id: "ddv", name: "Diario del Valle", url: "https://ddv.example", kind: "newspaper", region: { country: "AR" } }];
  }
  async plans() {
    return [];
  }
  async preferences() {
    return this.prefs;
  }
  async updatePreferences(values: Partial<Preferences>) {
    this.log("updatePreferences", values);
    this.prefs = { ...this.prefs, ...values };
    return this.prefs;
  }
  async follow(topic: string) {
    this.log("follow", topic);
    this.prefs = { ...this.prefs, followedTopics: [...this.prefs.followedTopics, "t1"] };
    return { id: "t1", name: topic, synonyms: [] };
  }
  async unfollow(topic: string) {
    this.log("unfollow", topic);
    return { id: "t1", name: topic, synonyms: [] };
  }
  async quote(): Promise<never> {
    throw new Error("no usado");
  }
  async checkout(): Promise<never> {
    throw new Error("no usado");
  }
  async cancelSubscription() {
    this.log("cancelSubscription");
    if (this.session?.subscription) this.session = { ...this.session, subscription: { ...this.session.subscription, cancelAtPeriodEnd: true } };
  }
  async resumeSubscription() {
    this.log("resumeSubscription");
    if (this.session?.subscription) this.session = { ...this.session, subscription: { ...this.session.subscription, cancelAtPeriodEnd: false } };
  }
  async acceptLegal(docId: string, version: string) {
    this.log("acceptLegal", docId, version);
  }
  async deleteAccount(confirmation: string) {
    this.log("deleteAccount", confirmation);
  }
  myDataUrl() {
    return "/v1/me/data";
  }
}

export function sampleMe(extra: Partial<Me> = {}): Me {
  return {
    id: "u1",
    name: "Ana",
    createdAt: "2026-09-01T00:00:00Z",
    roles: ["reader"],
    channels: [{ type: "email", address: "ana@correo.example", verified: true }],
    plan: { id: "gratis", name: "Gratis", features: ["content_analysis", "smoke_analysis", "source_comparison"], limits: { analysesPerDay: 5, comparisonsPerMonth: 3, maxSourcesPerComparison: 4, maxIncludeUrls: 0, seats: 1 }, price: null },
    usage: { analyses: 2, comparisons: 0 },
    pendingLegal: [],
    ...extra,
  };
}

export function sampleAnalysis(): Analysis {
  return {
    id: "an1",
    at: "2026-09-28T12:00:00Z",
    sourceType: "message",
    text: "URGENTE: mañana cortan el agua.",
    smokeIndex: 83,
    facts: [],
    findings: [
      { type: "alarmism", excerpt: "urgente", explanation: "Lenguaje que busca generar miedo más que informar." },
      { type: "chain_call", excerpt: "reenviá", explanation: "Pide que se reenvíe." },
    ],
    cleanVersion: "",
    signals: [{ id: "s1", level: "warning", label: "Reenviado muchas veces", detail: "WhatsApp lo marca como cadena." }],
    links: [],
  };
}

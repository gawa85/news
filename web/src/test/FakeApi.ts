import { ApiError } from "../api/ApiError";
import type { SinHumoApi } from "../api/SinHumoApi";
import type { AlertRule, AlertTrigger, Analysis, ApiKey, CredibilityReport, EvidenceSnapshot, EvidenceVerification, Me, OriginTrace, Preferences, PublicEvent, QuizResult, MyReview, OrganizationOverview, RoomEvent, Webhook, TeamRoom, Ticket, TimelinePoint } from "../api/types";

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

  /** Simula "mucha actividad desde tu red": el servidor pide captcha. */
  demandCaptcha = false;
  async authOptions() {
    return { providers: ["google"], captcha: this.demandCaptcha ? { provider: "turnstile", siteKey: "k" } : null };
  }
  async requestMagicLink(email: string, captchaToken?: string, next?: string) {
    this.log("requestMagicLink", email, captchaToken, next);
    if (this.demandCaptcha && !captchaToken) {
      throw new ApiError(403, "Resolvé la verificación para seguir.", "captcha_required", undefined, undefined, { provider: "turnstile", siteKey: "k" });
    }
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
  async credibility(): Promise<CredibilityReport> {
    return { outletName: "Diario del Valle", overall: 0.6, sampleSize: 8, disclaimer: "", dimensions: [], corrections: [], rebuttals: [] };
  }
  async credibilityTimeline(input: { windows: number }): Promise<TimelinePoint[]> {
    this.log("credibilityTimeline", input);
    const scores = [0.7, null, 0.5];
    return scores.map((overall, i) => ({
      period: { from: `2026-0${i * 2 + 1}-01T00:00:00Z`, to: `2026-0${i * 2 + 2}-28T00:00:00Z` },
      report: { outletName: "Diario del Valle", overall, sampleSize: overall === null ? 0 : 4, disclaimer: "", dimensions: [{ dimensionId: "accuracy", label: "Precisión", score: overall, confidence: 0.5, summary: "", evidence: [] }] },
    }));
  }
  /** Links que el servidor todavía no tiene guardados (piden el tema). */
  unknownUrls = new Set<string>();
  async traceOrigin(url: string, topic?: string): Promise<OriginTrace> {
    this.log("traceOrigin", url, topic);
    if (this.unknownUrls.has(url) && !topic) throw new ApiError(400, "No tenemos esa nota todavía: indicá de qué tema habla.");
    const art = (id: string, outletId: string, day: string, title: string) => ({ id, outletId, title, url: `https://${outletId}.example/${id}`, publishedAt: `2026-03-${day}T12:00:00Z` });
    const origin = art("ana-1", "ana", "10", "Aprueban aumento del gas");
    const target = art("ddv-1", "ddv", "11", "Golpe histórico: sube el gas");
    return {
      target, origin,
      chain: [{ article: origin, similarityToOrigin: 1, isNearCopy: false }, { article: target, similarityToOrigin: 0.82, isNearCopy: true }],
      independentSources: 1, likelyPressRelease: false, echoWarning: undefined,
    };
  }

  alertList: AlertRule[] = [];
  async alerts() {
    return this.alertList;
  }
  async createAlert(input: { topic: string; trigger: AlertTrigger; channel: string; outletId?: string }) {
    this.log("createAlert", input);
    const a: AlertRule = { id: `al${this.alertList.length + 1}`, ...input, active: true, createdAt: "2026-09-28T12:00:00Z" };
    this.alertList = [a, ...this.alertList];
    return a;
  }
  async deactivateAlert(id: string) {
    this.log("deactivateAlert", id);
    this.alertList = this.alertList.filter((a) => a.id !== id);
  }

  keys: ApiKey[] = [];
  async apiKeys() {
    return { available: !!this.session?.plan.features.includes("api_access"), scopes: ["content:analyze", "smoke:analyze", "sources:compare"], keys: this.keys };
  }
  async createApiKey(name: string, scopes: string[]) {
    this.log("createApiKey", name, scopes);
    const key: ApiKey = { id: "k1", prefix: "sh_live_abcd", name, scopes, revoked: false, createdAt: "2026-09-28T12:00:00Z" };
    this.keys = [key, ...this.keys];
    return { plaintext: "sh_live_abcdSECRETO", key };
  }
  async revokeApiKey(id: string) {
    this.log("revokeApiKey", id);
  }

  answered = 0;
  async learningNext() {
    return { itemId: "q1", text: "URGENTE: reenviá, mañana cortan el agua en todo el país." };
  }
  async learningAnswer(isSmoke: boolean): Promise<QuizResult> {
    this.log("learningAnswer", isSmoke);
    this.answered++;
    return { correct: isSmoke, wasSmoke: true, explanation: "Alarmismo y pedido de reenvío, sin fuente.", streak: isSmoke ? 1 : 0, score: { answered: this.answered, correct: isSmoke ? 1 : 0, level: "Aprendiz" } };
  }
  async learningProgress() {
    return { answered: this.answered, correct: 0, bestStreak: 0, level: "Aprendiz" };
  }
  async joinClassroom(code: string, alias: string) {
    this.log("joinClassroom", code, alias);
  }

  async observatory(month: string) {
    return {
      period: { from: `${month}-01T03:00:00Z`, to: `${month}-28T03:00:00Z` }, minGroupSize: 10, rounding: 5,
      totals: { analyses: 12_345, smokeRate: 0.42 },
      smokeTypes: [{ type: "alarmism", count: 3200 }, { type: "chain_call", count: 2100 }],
      channels: [{ channel: "whatsapp", count: 9000 }],
      topics: [{ topic: "tarifas de gas", count: 800 }],
      narratives: [], suppressedGroups: 2, methodology: "Se cuentan análisis por día; se publican grupos grandes y redondeados.",
    };
  }
  async narratives() {
    return [{ id: "n1", sample: "Mañana cortan el agua en todo el país", firstSeenAt: "2026-09-20T12:00:00Z", lastSeenAt: "2026-09-28T12:00:00Z", occurrences: 340, avgSmokeIndex: 81, status: "circulating" as const, countered: false }];
  }
  async outletProfile(id: string) {
    if (id !== "ddv") throw new ApiError(404, "No existe ese medio.");
    return {
      outlet: { id: "ddv", name: "Diario del Valle", url: "https://ddv.example", kind: "newspaper", region: { country: "AR", province: "Valle" } },
      owners: [{ name: "Grupo Andino", businessSectors: ["energía"], since: "2019-01-01T00:00:00Z", source: "registro público" }],
      advertising: [{ payer: "Gobierno de la Provincia del Valle", jurisdiction: "provincial", amount: 96_000_000, currency: "ARS" }],
      rebuttals: [{ id: "r1", outletId: "ddv", statement: "La nota citaba la resolución oficial.", evidenceUrls: [], status: "accepted" as const, createdAt: "2026-09-01T00:00:00Z", resolution: { note: "Tenían razón.", at: "2026-09-03T00:00:00Z" } }],
      corrections: [{ id: "c1", target: { type: "verdict", id: "x" }, outletId: "ddv", description: "Corregimos el veredicto sobre la baja del gas.", publishedAt: "2026-09-03T00:00:00Z", rebuttalId: "r1" }],
    };
  }
  async corrections() {
    return [{ id: "c1", target: { type: "verdict", id: "x" }, outletId: "ddv", description: "Corregimos el veredicto sobre la baja del gas.", publishedAt: "2026-09-03T00:00:00Z", rebuttalId: "r1" }];
  }
  async datasets() {
    return [{ id: "humo-mensual", title: "Humo por mes", description: "Análisis y tipos de humo por mes.", license: "CC BY 4.0", updateFrequency: "cada día", columns: [{ name: "mes", description: "AAAA-MM" }] }];
  }
  datasetUrl(id: string, format: string) {
    return `/public/datasets/${id}.${format}`;
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

  ticketList: Ticket[] = [];
  async tickets() {
    return this.ticketList;
  }
  async openTicket(input: { text: string; category?: string }) {
    this.log("openTicket", input);
    const t: Ticket = {
      id: "T-ABC123", subject: input.text.slice(0, 40), category: "other", priority: "normal", status: "open",
      messages: [{ id: "m1", role: "requester", text: input.text, at: "2026-09-28T12:00:00Z" }],
      firstResponseDueAt: "2026-09-30T12:00:00Z", createdAt: "2026-09-28T12:00:00Z", updatedAt: "2026-09-28T12:00:00Z",
    };
    this.ticketList = [t, ...this.ticketList];
    return t;
  }
  async replyTicket(id: string, text: string) {
    this.log("replyTicket", id, text);
    return this.ticketList[0]!;
  }
  async rateTicket(id: string, score: number) {
    this.log("rateTicket", id, score);
  }

  snapshots: EvidenceSnapshot[] = [];
  async evidence() {
    return this.snapshots;
  }
  async evidenceHistory() {
    return this.snapshots;
  }
  async capture(url: string, monitor: boolean) {
    this.log("capture", url, monitor);
    const s: EvidenceSnapshot = { id: "ev1", url, finalUrl: url, capturedAt: "2026-09-28T12:00:00Z", reason: "manual", status: "captured", title: "Suben las tarifas", rawSha256: "a".repeat(64), externalCopies: [] };
    this.snapshots = [s, ...this.snapshots];
    return s;
  }
  async verifyEvidence(id: string): Promise<EvidenceVerification> {
    return { snapshotId: id, ok: true, checks: [{ name: "Huella del registro", ok: true }] };
  }
  evidenceFileUrl(id: string, kind: string) {
    return `/v1/evidence/${id}/content?kind=${kind}`;
  }

  liveEvent: PublicEvent = {
    id: "room1", code: "ABC234", title: "Debate presidencial", host: "Diario Norte", startsAt: "2026-09-28T21:00:00Z", endsAt: "2026-09-28T23:00:00Z",
    status: "live", watching: 3, pinned: [{ id: "p1", alias: "Equipo del evento", text: "FALSO: la inflación fue 3,7%.", links: [], flags: ["verificacion"], at: "2026-09-28T21:10:00Z", deleted: false }],
  };
  /** Para simular mensajes en vivo desde la prueba. */
  emit?: (e: RoomEvent) => void;
  async events() {
    return [this.liveEvent];
  }
  async event() {
    return this.liveEvent;
  }
  watchEvent(_code: string, onEvent: (e: RoomEvent) => void) {
    this.emit = onEvent;
    onEvent({ type: "history", messages: [] });
    return () => {
      this.emit = undefined;
    };
  }
  async postToRoom(roomId: string, text: string, kind?: string) {
    this.log("postToRoom", roomId, text, kind);
  }

  async checkMedia(file: File) {
    this.log("checkMedia", file.name, file.type);
    return {
      kind: "image" as const,
      summary: "Ojo: ya circuló antes.",
      signals: [{ id: "seen_before", level: "warning" as const, label: "Ya circuló antes", detail: "Nos llegó por primera vez el 12/03/2024." }],
      file: { width: 1280, height: 960, software: ["Adobe Photoshop 25.0"] },
    };
  }

  hooks: Webhook[] = [];
  async webhooks() {
    return { available: !!this.session?.plan.features.includes("webhooks"), events: ["analysis.completed", "alert.triggered"], webhooks: this.hooks };
  }
  async createWebhook(url: string, events: string[]) {
    this.log("createWebhook", url, events);
    const webhook: Webhook = { id: "w1", url, events, active: true, createdAt: "2026-09-28T12:00:00Z" };
    this.hooks = [webhook, ...this.hooks];
    return { webhook, signingSecret: "whsec_SECRETO" };
  }
  async testWebhook(id: string) {
    this.log("testWebhook", id);
    return { ok: false, status: 500, error: "Respondió HTTP 500." };
  }
  async removeWebhook(id: string) {
    this.log("removeWebhook", id);
  }
  myRating: MyReview | null = null;
  async myReview() {
    return this.myRating;
  }
  async review(_target: unknown, rating: number | null, text?: string) {
    this.log("review", rating, text);
    this.myRating = { rating, text, status: text ? "pending_moderation" : "published", updatedAt: "2026-09-28T12:00:00Z" };
    return this.myRating;
  }
  async reviewSummary() {
    return { count: 12, average: 4.3, distribution: { "1": 0, "2": 1, "3": 1, "4": 3, "5": 7 } };
  }

  org: OrganizationOverview | undefined;
  async organization() {
    return this.org;
  }
  async createOrganization(name: string) {
    this.log("createOrganization", name);
    this.org = sampleOrg({ organization: { id: "org1", name, createdAt: "2026-09-28T12:00:00Z" } });
    return this.org;
  }
  async inviteMember(email: string, roleId: string) {
    this.log("inviteMember", email, roleId);
    this.org = { ...this.org!, seats: { ...this.org!.seats, used: this.org!.seats.used + 1 }, invitations: [...this.org!.invitations, { id: "i1", email, roleId, createdAt: "2026-09-28T12:00:00Z", expiresAt: "2026-10-05T12:00:00Z" }] };
  }
  async revokeInvitation(id: string) {
    this.log("revokeInvitation", id);
    this.org = { ...this.org!, invitations: this.org!.invitations.filter((i) => i.id !== id) };
  }
  async setMemberRole(memberId: string, roleId: string) {
    this.log("setMemberRole", memberId, roleId);
    this.org = { ...this.org!, members: this.org!.members.map((m) => (m.id === memberId ? { ...m, roleIds: [roleId] } : m)) };
    return this.org;
  }
  async removeMember(memberId: string) {
    this.log("removeMember", memberId);
    this.org = { ...this.org!, members: this.org!.members.filter((m) => m.id !== memberId) };
    return this.org;
  }
  async leaveOrganization() {
    this.log("leaveOrganization");
    this.org = undefined;
  }
  async invitation(token: string) {
    if (token !== "bueno") throw new ApiError(400, "La invitación venció o ya se usó. Pedile a quien te invitó que te mande otra.");
    return { organization: "Diario Norte", invitedBy: "Juan", email: "ana@correo.example", expiresAt: "2026-10-05T12:00:00Z" };
  }
  async joinOrganization(token: string) {
    this.log("joinOrganization", token);
    this.org = sampleOrg();
    return this.org;
  }

  teamRooms: TeamRoom[] = [];
  canModerateRooms = false;
  /** Para simular lo que pasa en una sala del equipo. */
  emitRoom?: (e: RoomEvent) => void;
  async rooms() {
    return this.teamRooms;
  }
  async createRoom(input: { name: string; topic?: string }) {
    this.log("createRoom", input);
    const r: TeamRoom = { id: `room${this.teamRooms.length + 1}`, name: input.name, topic: input.topic, createdBy: this.session?.id ?? "u1", createdAt: "2026-09-28T12:00:00Z", slowModeSeconds: 0 };
    this.teamRooms = [...this.teamRooms, r];
    return r;
  }
  async room(id: string) {
    const room = this.teamRooms.find((r) => r.id === id);
    if (!room) throw new ApiError(404, "No existe esa sala.");
    return { room, members: [{ id: "u1", name: "Ana" }, { id: "u2", name: "Juan" }], canModerate: this.canModerateRooms };
  }
  async archiveRoom(id: string) {
    this.log("archiveRoom", id);
  }
  async deleteRoomMessage(id: string) {
    this.log("deleteRoomMessage", id);
  }
  watchRoom(_id: string, onEvent: (e: RoomEvent) => void) {
    this.emitRoom = onEvent;
    onEvent({ type: "history", messages: [] });
    return () => {
      this.emitRoom = undefined;
    };
  }
}

export function sampleMe(extra: Partial<Me> = {}): Me {
  return {
    id: "u1",
    name: "Ana",
    createdAt: "2026-09-01T00:00:00Z",
    roles: ["reader"],
    permissions: [],
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

export function sampleOrg(extra: Partial<OrganizationOverview> = {}): OrganizationOverview {
  return {
    organization: { id: "org1", name: "Diario Norte", createdAt: "2026-09-28T12:00:00Z" },
    plan: { id: "equipo", name: "Equipo" },
    seats: { used: 2, limit: 10 },
    canManage: true,
    members: [
      { id: "u1", name: "Ana", roleIds: ["org_admin"], email: "ana@correo.example", isMe: true },
      { id: "u2", name: "Juan", roleIds: ["reader"], email: "juan@correo.example", isMe: false },
    ],
    roles: [
      { id: "reader", name: "Lector", description: "Usa las funciones del plan." },
      { id: "moderator", name: "Moderador", description: "Aprueba respuestas públicas." },
      { id: "org_admin", name: "Administrador de organización", description: "Gestiona miembros y roles." },
    ],
    invitations: [],
    ...extra,
  };
}

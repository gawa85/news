/**
 * ADAPTADOR DE ENTRADA HTTP (sin frameworks, node:http).
 *
 *  API para bots/sistemas (Bearer <clave de API>):
 *    POST /v1/analyze        { text, url? }
 *    POST /v1/compare        { topic, from, to, urlRules? }
 *    POST /v1/credibility    { outletId, topic, from, to }
 *    GET  /v1/plan
 *    POST /v1/reviews        { target: {type,id}, rating, text? }
 *    GET  /v1/reviews/summary?type=&id=
 *    POST /v1/replies        { target, content, topic? }
 *    GET  /v1/impact?from=&to=
 *    POST /mcp               MCP por HTTP (Streamable HTTP, sin estado)
 *
 *  Webhooks de proveedores:
 *    GET/POST /webhooks/whatsapp   (verificación + firma X-Hub-Signature-256)
 *    POST     /webhooks/telegram   (token secreto en encabezado)
 *    POST     /webhooks/payments   (firma HMAC)
 *
 *  Login web (sesión en cookie HttpOnly):
 *    POST /auth/magic-link { email }      GET /auth/magic?token=
 *    POST /auth/login { email, password } POST /auth/password { email, password } (con sesión)
 *    GET  /auth/:proveedor  →  GET /auth/:proveedor/callback
 *    POST /auth/logout                    POST /auth/logout-all
 *  Con sesión o clave de API también:
 *    GET  /v1/export?kind=&format=&…      GET /v1/audit?from=&to=
 *    POST /v1/rebuttals                   POST /v1/rebuttals/:id/resolve
 *
 *  Mis datos (Ley 25.326):  GET /v1/me/data   POST /v1/me/delete { confirmation }
 *  Facturación:  POST /v1/billing/profile   GET /v1/invoices
 *  Costos (administración):  GET /v1/costs?from=&to=
 *  Verificación:  GET /v1/verification/tasks
 *    POST /v1/verification/tasks/:id/(take|suggest|evidence|resolve|discard)
 *    POST /v1/verification/documents
 *  Participación:
 *    GET  /public/narratives?days=          humo en circulación
 *    GET  /public/perspectives?type=&id=    otras miradas (agrupadas por tipo)
 *    POST /v1/perspectives   POST /v1/perspectives/:id/vote
 *    POST /v1/campaigns      POST /v1/campaigns/:id/(review|launch|allies|respond)   GET /v1/campaigns/:id/report
 *    GET/POST /v1/rooms      GET /v1/rooms/:id/events (SSE, tiempo real)   POST /v1/rooms/:id/messages
 *  Estadísticas:
 *    GET /v1/stats/panel?scope=user|organization&from=&to=   GET /v1/stats/business?from=&to=
 *    GET /v1/bi/:dataset?scope=&since=&limit=   (analyses | daily_stats; para Power BI, Looker, Metabase)
 *    GET/POST /v1/reports/schedules    DELETE /v1/reports/schedules/:id
 *    GET /public/observatory?month=AAAA-MM
 *    GET /public/datasets    GET /public/datasets/:id.(csv|json)?from=&to=   (datos abiertos, CC BY 4.0)
 *  Configuración del negocio:
 *    GET /public/topics                     árbol de categorías y temas
 *    POST /v1/taxonomy/categories  POST /v1/taxonomy/topics   (taxonomy:manage)
 *    GET/PATCH /v1/me/preferences   POST /v1/me/preferences/(follow|unfollow) { topic }
 *    PUT /v1/organization/preferences { values, locked }
 *    GET/POST /v1/business-rules   POST /v1/business-rules/:id/(test|approve|archive)   GET /v1/business-rules/:id/history
 *    GET /v1/parameters   PUT /v1/parameters/:key { value, reason }
 *  Comercial:
 *    GET /public/countries   GET /v1/quote?planId=&interval=&coupon=   POST /v1/checkout { planId, interval, couponCode }
 *    PUT /v1/me/country { country }   POST /v1/coupons   POST /v1/coupons/:code/deactivate
 *    GET /v1/referrals   POST /v1/referrals/apply { code }
 *    PUT /v1/organization/branding   POST /v1/organization/branding/(domain|verify)   GET /public/branding (por dominio)
 *  Aprendizaje:  POST /v1/learning/next   POST /v1/learning/answer { isSmoke }   GET /v1/learning/progress
 *    POST /v1/classrooms   POST /v1/classrooms/join { code, alias }   GET /v1/classrooms/:id/report
 *  Soporte:  GET/POST /v1/support/tickets   POST /v1/support/tickets/:id/(messages|reply|rate)   GET /v1/support/queue
 *  Funciones en prueba:  GET /v1/flags   PATCH /v1/flags/:key
 *  Audios firmados:  GET /media/:id?exp=&sig=
 *  Operación:  GET/POST /v1/ops/backups (ops:backup)   GET /health (con el ambiente)
 *  Legal:  GET /public/legal   GET /v1/legal/pending   POST /v1/legal/accept { docId, version }
 *  Métricas (Prometheus, con token):  GET /metrics
 *
 *  Público:
 *    GET /r/:code   link de seguimiento → redirección
 *    GET /public/outlets/:id/record  réplicas y correcciones de un medio
 *    GET /public/corrections         fe de erratas
 *    GET /health
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { AccessControl } from "../../application/access/AccessControl";
import type { Caller, ProductGateway } from "../../application/access/ProductGateway";
import type { ImpactReportUseCase } from "../../application/impact/ImpactUseCases";
import type { ApiKeyService } from "../../application/integrations/IntegrationServices";
import type { HandleInboundMessageUseCase } from "../../application/messaging/HandleInboundMessageUseCase";
import type { ResponseComposer } from "../../application/messaging/ResponseComposer";
import type { ReplyService, TrackedLinkService } from "../../application/replies/ReplyService";
import type { ReviewService } from "../../application/reviews/ReviewService";
import type { ConfirmPaymentUseCase } from "../../application/users/PlansUseCases";
import type { AuthService } from "../../application/auth/AuthService";
import type { AuditQueryUseCase } from "../../application/audit/Audit";
import type { ExportRequest, ExportService } from "../../application/exports/ExportService";
import type { RebuttalService } from "../../application/rebuttals/Rebuttals";
import type { ExportFormat } from "../../domain/model";
import type { SetBillingProfileUseCase } from "../../application/billing/Invoicing";
import type { CostReportUseCase } from "../../application/costs/Costs";
import type { VerificationDesk } from "../../application/factcheck/VerificationDesk";
import type { PersonalDataService } from "../../application/privacy/PersonalData";
import type { IInvoiceRepository } from "../../domain/ports";
import { billingSubjectOf } from "../../application/access/AccessControl";
import type { CampaignService } from "../../application/participation/Campaigns";
import type { NarrativeTracker } from "../../application/participation/Narratives";
import type { PerspectiveService } from "../../application/participation/Perspectives";
import type { RoomService } from "../../application/participation/Rooms";
import type { ImportCatalogUseCase } from "../../application/catalog/CatalogUseCases";
import type { FeedbackService, QualityService } from "../../application/quality/Quality";
import type { EvaluationRun } from "../../domain/model";
import type { StatsService } from "../../application/stats/Stats";
import type { TaxonomyService } from "../../application/config/Taxonomy";
import type { BrandingService, CommerceService, ReferralService } from "../../application/commerce/Commerce";
import type { LearningService } from "../../application/learning/Learning";
import type { SupportService } from "../../application/support/Support";
import type { FeatureFlagService } from "../../application/flags/FeatureFlags";
import type { ChangePlanUseCase } from "../../application/users/PlansUseCases";
import type { LegalService } from "../../application/legal/Legal";
import type { BackupService } from "../../application/ops/Backups";
import type { ICountryRegistry, IMediaStore } from "../../domain/ports";
import type { PreferencesService } from "../../application/config/Preferences";
import type { BusinessRulesService, ParameterService } from "../../application/config/BusinessRules";
import type { BiFeedService, OpenDataService } from "../../application/stats/OpenData";
import type { ScheduledReportService } from "../../application/exports/ScheduledReports";
import type { IAuthorizationService, IInboundParser, ILogger, IOutletReader } from "../../domain/ports";
import type { DeliveryStatusCollector } from "../impact/Collectors";
import { buildMcpServer } from "../integrations/McpServer";

export interface HttpApiDeps {
  gateway: ProductGateway;
  access: AccessControl;
  authz: IAuthorizationService;
  apiKeys: ApiKeyService;
  composer: ResponseComposer;
  replies: ReplyService;
  reviews: ReviewService;
  impactReport: ImpactReportUseCase;
  trackedLinks: TrackedLinkService;
  inbound: HandleInboundMessageUseCase;
  confirmPayment: ConfirmPaymentUseCase;
  deliveryStatus: DeliveryStatusCollector;
  outlets: IOutletReader;
  parsers: { whatsapp: IInboundParser; telegram: IInboundParser };
  secrets: { whatsappVerifyToken: string; whatsappAppSecret: string; telegramSecretToken: string; paymentsSecret: string };
  logger: ILogger;
  maxBodyBytes?: number;
  auth: AuthService;
  exports: ExportService;
  audit: AuditQueryUseCase;
  rebuttals: RebuttalService;
  publicBaseUrl: string;
  verification: VerificationDesk;
  personalData: PersonalDataService;
  billingProfile: SetBillingProfileUseCase;
  invoices: IInvoiceRepository;
  costReport: CostReportUseCase;
  participation: { narratives: NarrativeTracker; campaigns: CampaignService; perspectives: PerspectiveService; rooms: RoomService };
  catalog: { import: ImportCatalogUseCase };
  stats: { service: StatsService; openData: OpenDataService; biFeed: BiFeedService; scheduledReports: ScheduledReportService };
  config: { taxonomy: TaxonomyService; preferences: PreferencesService; businessRules: BusinessRulesService; params: ParameterService };
  commerce: { service: CommerceService; referrals: ReferralService; branding: BrandingService; countries: ICountryRegistry };
  inclusion: { learning: LearningService; media: IMediaStore };
  flags: FeatureFlagService;
  support: SupportService;
  changePlan: ChangePlanUseCase;
  legal: LegalService;
  backups?: BackupService;
  environment?: string;
  quality: { service: QualityService; feedback: FeedbackService; evaluateCurrent: (actorId: string) => Promise<EvaluationRun>; currentVersion: () => string };
  /** Texto de métricas (Prometheus) y token para leerlas. */
  metrics?: { render: () => string; token: string };
}

const COOKIE = "sh_session";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function createHttpApi(deps: HttpApiDeps): Server {
  const maxBody = deps.maxBodyBytes ?? 1_000_000;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      const raw = req.method === "POST" ? await readBody(req, maxBody) : Buffer.alloc(0);
      await route(req, res, url, raw);
    } catch (err) {
      const [status, body] = toHttpError(err);
      if (status >= 500) deps.logger.error("Error en la API", { path: url.pathname, error: String(err) });
      if (!res.headersSent) json(res, status, body);
    }
  });

  /**
   * Quién llama: clave de API (bots, agentes) o sesión web (cookie).
   * Con cookie, los POST deben venir del propio sitio (Origin): protección contra CSRF.
   */
  async function caller(req: IncomingMessage): Promise<Caller> {
    const auth = req.headers.authorization ?? "";
    if (auth.startsWith("Bearer ")) return deps.apiKeys.authenticate(auth.slice(7));
    const session = cookies(req)[COOKIE];
    if (!session) throw new AccessDeniedError("Falta la clave de API o la sesión.", "no_permission");
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = String(req.headers.origin ?? req.headers.referer ?? "");
      if (!origin.startsWith(new URL(deps.publicBaseUrl).origin)) throw new HttpError(403, "Origen no permitido.");
    }
    return deps.auth.authenticateSession(session);
  }

  function setSession(res: ServerResponse, token: string | null): void {
    const secure = deps.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    res.setHeader("set-cookie", token
      ? `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86_400}${secure}`
      : `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
  }

  function meta(req: IncomingMessage) {
    return { userAgent: String(req.headers["user-agent"] ?? ""), ip: req.socket.remoteAddress };
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL, raw: Buffer): Promise<void> {
    const path = url.pathname;
    const body = () => parseJson(raw);

    if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true, environment: deps.environment ?? "development" });

    if (req.method === "GET" && path === "/metrics") {
      const auth = String(req.headers.authorization ?? "");
      if (!deps.metrics || !deps.metrics.token || !safeEqual(auth, `Bearer ${deps.metrics.token}`)) throw new HttpError(403, "Métricas protegidas.");
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4" }).end(deps.metrics.render());
      return;
    }

    if (req.method === "GET" && path.startsWith("/r/")) {
      const target = await deps.trackedLinks.resolve(path.slice(3));
      if (!target) throw new HttpError(404, "Link inexistente.");
      res.writeHead(302, { location: target, "cache-control": "no-store" }).end();
      return;
    }

    // ---- Público ----
    const record = path.match(/^\/public\/outlets\/([^/]+)\/record$/);
    if (req.method === "GET" && record) return json(res, 200, await deps.rebuttals.publicRecord(decodeURIComponent(record[1]!)));
    if (req.method === "GET" && path === "/public/corrections") return json(res, 200, await deps.rebuttals.recentCorrections());
    if (req.method === "GET" && path === "/public/narratives") {
      const days = Math.min(90, Number(url.searchParams.get("days") ?? 7));
      return json(res, 200, (await deps.participation.narratives.top(days)).map(({ campaignIds, ...n }) => ({ ...n, countered: campaignIds.length > 0 })));
    }
    if (req.method === "GET" && path === "/public/observatory") {
      const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
      return json(res, 200, await deps.stats.service.observatory(month));
    }
    if (req.method === "GET" && path === "/public/datasets") return json(res, 200, deps.stats.openData.list());
    if (req.method === "GET" && path === "/public/topics") return json(res, 200, await deps.config.taxonomy.tree());
    if (req.method === "GET" && path === "/public/legal") return json(res, 200, deps.legal.current());
    if (req.method === "GET" && path === "/public/countries") {
      return json(res, 200, deps.commerce.countries.all().map(({ planPrices: _p, ...c }) => ({ ...c, regions: c.regions.map((r) => r.name) })));
    }
    if (req.method === "GET" && path === "/public/branding") {
      const b = await deps.commerce.branding.byHost(String(req.headers.host ?? ""));
      return b ? json(res, 200, b) : json(res, 404, { error: "Sin marca propia para este dominio." });
    }
    const mediaM = path.match(/^\/media\/([A-Za-z0-9_-]{8,64})$/);
    if (req.method === "GET" && mediaM) {
      const m = await deps.inclusion.media.get(mediaM[1]!, url.searchParams.get("sig") ?? "", Number(url.searchParams.get("exp") ?? 0));
      if (!m) return json(res, 404, { error: "El archivo no existe o el link venció." });
      return void res.writeHead(200, { "content-type": m.mime, "cache-control": "private, max-age=3600", "content-length": String(m.data.length) }).end(m.data);
    }
    const ds = path.match(/^\/public\/datasets\/([a-z0-9-]+)\.(csv|json)$/);
    if (req.method === "GET" && ds) {
      const to = url.searchParams.get("to") ? date(url.searchParams.get("to"), "to") : new Date();
      const from = url.searchParams.get("from") ? date(url.searchParams.get("from"), "from") : new Date(to.getTime() - 365 * 86_400_000);
      const { info, rows } = await deps.stats.openData.get(ds[1]!, { from, to });
      const headers = { "access-control-allow-origin": "*", "cache-control": "public, max-age=3600", "x-license": info.license };
      if (ds[2] === "json") return void res.writeHead(200, { ...headers, "content-type": "application/json; charset=utf-8" }).end(JSON.stringify({ ...info, rows }));
      return void res.writeHead(200, { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${info.id}.csv"` }).end(toCsv(info.columns.map((c) => c.name), rows));
    }
    if (req.method === "GET" && path === "/public/perspectives") {
      return json(res, 200, await deps.participation.perspectives.forTarget({ type: str(url.searchParams.get("type"), "type") as never, id: str(url.searchParams.get("id"), "id") }));
    }

    // ---- Login web ----
    if (path.startsWith("/auth/")) {
      if (req.method === "POST" && path === "/auth/magic-link") {
        await deps.auth.requestMagicLink(str((body() as { email?: string }).email, "email"));
        return json(res, 200, { ok: true, message: "Si el mail es válido, te llegó un enlace para entrar." });
      }
      if (req.method === "GET" && path === "/auth/magic") {
        const { token } = await deps.auth.consumeMagicLink(str(url.searchParams.get("token"), "token"), meta(req));
        setSession(res, token);
        res.writeHead(302, { location: "/" }).end();
        return;
      }
      if (req.method === "POST" && path === "/auth/login") {
        const b = body() as { email?: string; password?: string };
        const { token, user } = await deps.auth.loginWithPassword(str(b.email, "email"), str(b.password, "password"), meta(req));
        setSession(res, token);
        return json(res, 200, { ok: true, userId: user.id });
      }
      if (req.method === "POST" && path === "/auth/password") {
        const who = await caller(req);
        const b = body() as { email?: string; password?: string };
        await deps.auth.setPassword(who.userId, str(b.email, "email"), str(b.password, "password"));
        return json(res, 200, { ok: true });
      }
      if (req.method === "POST" && (path === "/auth/logout" || path === "/auth/logout-all")) {
        const token = cookies(req)[COOKIE];
        if (path === "/auth/logout-all") {
          const who = await caller(req);
          await deps.auth.logoutEverywhere(who.userId);
        } else if (token) await deps.auth.logout(token);
        setSession(res, null);
        return json(res, 200, { ok: true });
      }
      const oauth = path.match(/^\/auth\/([a-z]+)(\/callback)?$/);
      if (req.method === "GET" && oauth) {
        if (!oauth[2]) {
          res.writeHead(302, { location: await deps.auth.startOAuth(oauth[1]!, url.searchParams.get("next") ?? undefined) }).end();
          return;
        }
        const r = await deps.auth.completeOAuth(oauth[1]!, str(url.searchParams.get("state"), "state"), str(url.searchParams.get("code"), "code"), meta(req));
        setSession(res, r.token);
        res.writeHead(302, { location: r.redirectAfter?.startsWith("/") ? r.redirectAfter : "/" }).end();
        return;
      }
      throw new HttpError(404, "Ruta inexistente.");
    }

    // ---- Webhooks de proveedores ----
    if (path === "/webhooks/whatsapp") {
      if (req.method === "GET") {
        const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === deps.secrets.whatsappVerifyToken;
        if (!ok) throw new HttpError(403, "Token de verificación inválido.");
        res.writeHead(200, { "content-type": "text/plain" }).end(url.searchParams.get("hub.challenge") ?? "");
        return;
      }
      verifyHmac(raw, String(req.headers["x-hub-signature-256"] ?? ""), deps.secrets.whatsappAppSecret);
      const payload = body() as { entry?: { changes?: { value?: { statuses?: { id: string; status: string }[] } }[] }[] };
      for (const s of payload.entry?.[0]?.changes?.[0]?.value?.statuses ?? []) {
        if (s.status === "delivered" || s.status === "read") deps.deliveryStatus.record(s.id, s.status);
      }
      const msg = deps.parsers.whatsapp.parse(payload);
      json(res, 200, { ok: true }); // WhatsApp exige respuesta rápida: se procesa después
      if (msg) deps.inbound.execute(msg).catch((e) => deps.logger.error("Falló un mensaje de WhatsApp", { error: String(e) }));
      return;
    }
    if (req.method === "POST" && path === "/webhooks/telegram") {
      if (!safeEqual(String(req.headers["x-telegram-bot-api-secret-token"] ?? ""), deps.secrets.telegramSecretToken)) throw new HttpError(403, "Token inválido.");
      const msg = deps.parsers.telegram.parse(body());
      json(res, 200, { ok: true });
      if (msg) deps.inbound.execute(msg).catch((e) => deps.logger.error("Falló un mensaje de Telegram", { error: String(e) }));
      return;
    }
    if (req.method === "POST" && path === "/webhooks/payments") {
      verifyHmac(raw, String(req.headers["x-signature"] ?? ""), deps.secrets.paymentsSecret);
      const { subscriptionId } = body() as { subscriptionId?: string };
      if (!subscriptionId) throw new ValidationError("Falta subscriptionId.");
      const sub = await deps.confirmPayment.execute({ subscriptionId });
      return json(res, 200, { ok: true, status: sub.status });
    }

    // ---- MCP por HTTP ----
    if (path === "/mcp") {
      if (req.method !== "POST") throw new HttpError(405, "Usá POST.");
      const who = await caller(req);
      const server = buildMcpServer({ gateway: deps.gateway, access: deps.access, composer: deps.composer, replies: deps.replies, reviews: deps.reviews, outlets: deps.outlets }, who);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        transport.close().catch(() => undefined);
        server.close().catch(() => undefined);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body());
      return;
    }

    // ---- API para bots ----
    if (!path.startsWith("/v1/")) throw new HttpError(404, "Ruta inexistente.");
    const who = await caller(req);
    const b = ["POST", "PUT", "PATCH"].includes(req.method ?? "") ? (body() as Record<string, unknown>) : {};

    const vt = path.match(/^\/v1\/verification\/tasks\/([^/]+)\/(take|suggest|evidence|resolve|discard)$/);
    if (req.method === "POST" && vt) {
      const id = decodeURIComponent(vt[1]!);
      const v = deps.verification;
      switch (vt[2]) {
        case "take": return json(res, 200, await v.take(who.userId, id));
        case "suggest": return json(res, 200, await v.suggestEvidence(who.userId, id));
        case "evidence": return json(res, 200, await v.addEvidence(who.userId, id, b as never));
        case "resolve": return json(res, 200, await v.resolve({ actorId: who.userId, taskId: id, verdicts: b.verdicts as never, note: str(b.note, "note") }));
        default: return json(res, 200, await v.discard({ actorId: who.userId, taskId: id, note: str(b.note, "note") }));
      }
    }

    // ---- Participación ----
    const P = deps.participation;
    const camp = path.match(/^\/v1\/campaigns\/([^/]+)\/(review|launch|allies|respond|report)$/);
    if (camp) {
      const id = decodeURIComponent(camp[1]!);
      switch (`${req.method} ${camp[2]}`) {
        case "POST review": return json(res, 200, await P.campaigns.review({ actorId: who.userId, campaignId: id, approve: !!b.approve, note: str(b.note, "note"), political: b.political as boolean | undefined }));
        case "POST launch": return json(res, 200, await P.campaigns.launch({ actorId: who.userId, campaignId: id }));
        case "POST allies": return json(res, 200, { invited: await P.campaigns.inviteAllies({ actorId: who.userId, campaignId: id, userIds: (b.userIds as string[]) ?? [] }) });
        case "POST respond": return json(res, 200, await P.campaigns.respondAlly({ userId: who.userId, campaignId: id, accept: !!b.accept }).then(() => ({ ok: true })));
        case "GET report": return json(res, 200, await P.campaigns.report(id));
      }
    }
    const couponM = path.match(/^\/v1\/coupons\/([A-Za-z0-9-]+)\/deactivate$/);
    if (req.method === "POST" && couponM) {
      await deps.commerce.service.deactivateCoupon({ actorId: who.userId, code: couponM[1]! });
      return json(res, 200, { ok: true });
    }
    const classM = path.match(/^\/v1\/classrooms\/([^/]+)\/report$/);
    if (req.method === "GET" && classM) return json(res, 200, await deps.inclusion.learning.report({ teacherId: who.userId, classroomId: decodeURIComponent(classM[1]!) }));
    const tkt = path.match(/^\/v1\/support\/tickets\/([^/]+)\/(messages|reply|rate)$/);
    if (req.method === "POST" && tkt) {
      const ticketId = decodeURIComponent(tkt[1]!);
      if (tkt[2] === "messages") return json(res, 200, await deps.support.addFromRequester({ userId: who.userId, ticketId, text: str(b.text, "text") }));
      if (tkt[2] === "rate") return json(res, 200, await deps.support.rate({ userId: who.userId, ticketId, score: Number(b.score) }).then(() => ({ ok: true })));
      return json(res, 200, await deps.support.reply({ agentId: who.userId, ticketId, text: str(b.text, "text"), internal: !!b.internal, status: b.status as never }));
    }
    const flagM = path.match(/^\/v1\/flags\/([a-z0-9_]+)$/);
    if (req.method === "PATCH" && flagM) return json(res, 200, await deps.flags.update({ actorId: who.userId, key: flagM[1]!, ...(b as object) } as never));
    const brule = path.match(/^\/v1\/business-rules\/([^/]+)\/(test|approve|archive|history)$/);
    if (brule) {
      const ruleId = decodeURIComponent(brule[1]!);
      const R = deps.config.businessRules;
      switch (`${req.method} ${brule[2]}`) {
        case "POST test": return json(res, 200, await R.test({ actorId: who.userId, ruleId, scenarios: (b.scenarios as never[]) ?? [] }));
        case "POST approve": return json(res, 200, await R.approve({ actorId: who.userId, ruleId }));
        case "POST archive": return json(res, 200, await R.archive({ actorId: who.userId, ruleId }).then(() => ({ ok: true })));
        case "GET history": return json(res, 200, await R.history(who.userId, ruleId));
      }
    }
    const param = path.match(/^\/v1\/parameters\/([a-z0-9_.]+)$/);
    if (req.method === "PUT" && param) {
      return json(res, 200, await deps.config.params.set({ actorId: who.userId, key: param[1]!, value: b.value as never, reason: String(b.reason ?? "") }));
    }
    const sched = path.match(/^\/v1\/reports\/schedules\/([^/]+)$/);
    if (req.method === "DELETE" && sched) {
      await deps.stats.scheduledReports.remove({ actorId: who.userId, id: decodeURIComponent(sched[1]!) });
      return json(res, 200, { ok: true });
    }
    const bi = path.match(/^\/v1\/bi\/(analyses|daily_stats)$/);
    if (req.method === "GET" && bi) {
      const q = url.searchParams;
      const r = await deps.stats.biFeed.rows({
        actorId: who.userId, dataset: bi[1] as never, scope: q.get("scope") === "organization" ? "organization" : "user",
        since: q.get("since") ? date(q.get("since"), "since") : new Date(0), limit: q.get("limit") ? Number(q.get("limit")) : undefined, scopes: who.scopes,
      });
      if (q.get("format") === "csv") {
        return void res.writeHead(200, { "content-type": "text/csv; charset=utf-8", ...(r.nextSince ? { "x-next-since": r.nextSince } : {}) }).end(toCsv(Object.keys(r.rows[0] ?? {}), r.rows));
      }
      return json(res, 200, r);
    }
    const qrev = path.match(/^\/v1\/quality\/examples\/([^/]+)\/review$/);
    if (req.method === "POST" && qrev) {
      return json(res, 200, await deps.quality.service.reviewExample({ actorId: who.userId, exampleId: decodeURIComponent(qrev[1]!), isSmoke: !!b.isSmoke, types: (b.types as never[]) ?? [] }));
    }
    const pvote = path.match(/^\/v1\/perspectives\/(.+)\/vote$/);
    if (req.method === "POST" && pvote) return json(res, 200, await P.perspectives.vote({ actorId: who.userId, perspectiveId: decodeURIComponent(pvote[1]!), helpful: !!b.helpful }));
    const room = path.match(/^\/v1\/rooms\/([^/]+)\/(events|messages)$/);
    if (room) {
      const roomId = decodeURIComponent(room[1]!);
      if (req.method === "POST" && room[2] === "messages") return json(res, 201, await P.rooms.post({ actorId: who.userId, roomId, text: str(b.text, "text"), replyTo: b.replyTo as string | undefined }));
      if (req.method === "GET" && room[2] === "events") {
        // Server-Sent Events: el navegador mantiene la conexión y recibe cada novedad.
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        const { history, leave } = await P.rooms.join({ actorId: who.userId, roomId }, send);
        send({ type: "history", messages: history });
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(ping);
          leave();
        });
        return;
      }
    }

    const resolve = path.match(/^\/v1\/rebuttals\/([^/]+)\/resolve$/);
    if (req.method === "POST" && resolve) {
      return json(res, 200, await deps.rebuttals.resolve({ actorId: who.userId, rebuttalId: decodeURIComponent(resolve[1]!), decision: b.decision as never, note: str(b.note, "note") }));
    }

    switch (`${req.method} ${path}`) {
      case "GET /v1/export": {
        const q = url.searchParams;
        const kind = str(q.get("kind"), "kind");
        const period = () => ({ from: date(q.get("from"), "from"), to: date(q.get("to"), "to") });
        const request: ExportRequest =
          kind === "comparison" ? { kind, query: { topic: str(q.get("topic"), "topic"), period: period() } }
          : kind === "credibility" ? { kind, query: { outletId: str(q.get("outletId"), "outletId"), topic: str(q.get("topic"), "topic"), period: period() } }
          : kind === "analysis_history" ? { kind }
          : kind === "impact" || kind === "audit" || kind === "business_kpis" ? { kind, period: period() }
          : kind === "usage_panel" ? { kind, scope: q.get("scope") === "organization" ? "organization" : "user", period: period() }
          : (() => { throw new ValidationError(`Tipo de exportación desconocido: ${kind}`); })();
        const file = await deps.exports.export(who, request, (q.get("format") ?? "csv") as ExportFormat);
        res.writeHead(200, { "content-type": file.contentType, "content-disposition": `attachment; filename="${file.filename}"` }).end(file.data);
        return;
      }
      // ---- Configuración: temas, preferencias, reglas y parámetros ----
      case "POST /v1/taxonomy/categories":
        return json(res, 200, await deps.config.taxonomy.saveCategory({ actorId: who.userId, ...(b as object) } as never));
      case "POST /v1/taxonomy/topics":
        return json(res, 200, await deps.config.taxonomy.saveTopic({ actorId: who.userId, ...(b as object) } as never));
      case "GET /v1/me/preferences":
        return json(res, 200, await deps.config.preferences.effective(await deps.access.userOrThrow(who.userId)));
      case "PATCH /v1/me/preferences":
        return json(res, 200, await deps.config.preferences.update({ actorId: who.userId, values: b as never }));
      case "POST /v1/me/preferences/follow":
        return json(res, 200, await deps.config.preferences.follow(who.userId, str(b.topic, "topic")));
      case "POST /v1/me/preferences/unfollow":
        return json(res, 200, await deps.config.preferences.unfollow(who.userId, str(b.topic, "topic")));
      case "PUT /v1/organization/preferences":
        return json(res, 200, await deps.config.preferences.setOrgDefaults({ actorId: who.userId, values: (b.values ?? {}) as never, locked: b.locked as never }));
      case "GET /v1/business-rules":
        return json(res, 200, await deps.config.businessRules.list(who.userId));
      case "POST /v1/business-rules":
        return json(res, 201, await deps.config.businessRules.saveDraft({
          actorId: who.userId, ...(b as object),
          validFrom: b.validFrom ? date(b.validFrom, "validFrom") : undefined, validTo: b.validTo ? date(b.validTo, "validTo") : undefined,
        } as never));
      case "GET /v1/parameters":
        return json(res, 200, await deps.config.params.list(who.userId));
      // ---- Operación ----
      case "GET /v1/ops/backups": {
        if (!deps.backups) throw new HttpError(404, "Copias de seguridad sin configurar.");
        await deps.backups.requireOperator(who.userId);
        return json(res, 200, await deps.backups.list());
      }
      case "POST /v1/ops/backups": {
        if (!deps.backups) throw new HttpError(404, "Copias de seguridad sin configurar.");
        await deps.backups.requireOperator(who.userId);
        return json(res, 201, await deps.backups.create("manual"));
      }
      // ---- Legal ----
      case "GET /v1/legal/pending":
        return json(res, 200, await deps.legal.pendingFor(who.userId));
      case "POST /v1/legal/accept":
        return json(res, 200, await deps.legal.accept({ userId: who.userId, docId: str(b.docId, "docId") as never, version: str(b.version, "version"), method: "click", channel: "web" }));
      // ---- Comercial ----
      case "GET /v1/quote": {
        const q = url.searchParams;
        return json(res, 200, await deps.commerce.service.quote({ userId: who.userId, planId: str(q.get("planId"), "planId"), interval: q.get("interval") === "year" ? "year" : "month", couponCode: q.get("coupon") ?? undefined }));
      }
      case "POST /v1/checkout":
        return json(res, 200, await deps.changePlan.execute({ actorId: who.userId, planId: str(b.planId, "planId"), interval: b.interval === "year" ? "year" : "month", couponCode: b.couponCode as string | undefined }));
      case "PUT /v1/me/country":
        return json(res, 200, await deps.commerce.service.setCountry({ actorId: who.userId, country: str(b.country, "country") }));
      case "POST /v1/coupons":
        return json(res, 201, await deps.commerce.service.createCoupon({
          actorId: who.userId, ...(b as object), validFrom: b.validFrom ? date(b.validFrom, "validFrom") : undefined, validTo: b.validTo ? date(b.validTo, "validTo") : undefined,
        } as never));
      case "GET /v1/referrals":
        return json(res, 200, await deps.commerce.referrals.summary(who.userId));
      case "POST /v1/referrals/apply":
        return json(res, 200, await deps.commerce.referrals.apply({ userId: who.userId, code: str(b.code, "code") }));
      case "PUT /v1/organization/branding":
        return json(res, 200, await deps.commerce.branding.update({ actorId: who.userId, ...(b as object) } as never));
      case "POST /v1/organization/branding/domain":
        return json(res, 200, await deps.commerce.branding.setDomain({ actorId: who.userId, domain: str(b.domain, "domain") }));
      case "POST /v1/organization/branding/verify":
        return json(res, 200, await deps.commerce.branding.verifyDomain(who.userId));
      // ---- Aprendizaje ----
      case "POST /v1/learning/next":
        return json(res, 200, await deps.inclusion.learning.next(who.userId));
      case "POST /v1/learning/answer":
        return json(res, 200, await deps.inclusion.learning.answer(who.userId, !!b.isSmoke));
      case "GET /v1/learning/progress":
        return json(res, 200, await deps.inclusion.learning.progress(who.userId));
      case "POST /v1/classrooms":
        return json(res, 201, await deps.inclusion.learning.createClassroom({ teacherId: who.userId, name: str(b.name, "name"), showLeaderboard: !!b.showLeaderboard }));
      case "POST /v1/classrooms/join":
        return json(res, 200, await deps.inclusion.learning.join({ userId: who.userId, code: str(b.code, "code"), alias: str(b.alias, "alias") }));
      // ---- Soporte ----
      case "GET /v1/support/tickets":
        return json(res, 200, await deps.support.listMine(who.userId));
      case "POST /v1/support/tickets":
        return json(res, 201, await deps.support.open({ userId: who.userId, text: str(b.text, "text"), subject: b.subject as string | undefined, category: b.category as never, channel: "web" }));
      case "GET /v1/support/queue":
        return json(res, 200, await deps.support.queue(who.userId));
      // ---- Funciones en prueba ----
      case "GET /v1/flags":
        return json(res, 200, await deps.flags.list(who.userId));
      // ---- Estadísticas ----
      case "GET /v1/stats/panel": {
        const q = url.searchParams;
        const scope = q.get("scope") === "organization" ? "organization" : "user";
        return json(res, 200, await deps.stats.service.panel({ actorId: who.userId, scope, period: { from: date(q.get("from"), "from"), to: date(q.get("to"), "to") } }));
      }
      case "GET /v1/stats/business":
        return json(res, 200, await deps.stats.service.business({ actorId: who.userId, period: { from: date(url.searchParams.get("from"), "from"), to: date(url.searchParams.get("to"), "to") } }));
      case "GET /v1/reports/schedules":
        return json(res, 200, await deps.stats.scheduledReports.list(who.userId));
      case "POST /v1/reports/schedules":
        return json(res, 201, await deps.stats.scheduledReports.create({
          actorId: who.userId, name: String(b.name ?? ""), kind: str(b.kind, "kind") as never, scope: b.scope as never,
          format: (b.format ?? "xlsx") as ExportFormat, frequency: str(b.frequency, "frequency") as never, recipients: (b.recipients as string[]) ?? [],
        }));
      case "GET /v1/audit": {
        const q = url.searchParams;
        return json(res, 200, await deps.audit.execute({ actorId: who.userId, filter: { from: q.get("from") ? date(q.get("from"), "from") : undefined, to: q.get("to") ? date(q.get("to"), "to") : undefined, action: q.get("action") ?? undefined } }));
      }
      case "GET /v1/me/data": {
        const data = await deps.personalData.exportMyData(who.userId);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="mis-datos-sin-humo.json"' }).end(JSON.stringify(data, null, 2));
        return;
      }
      case "POST /v1/me/delete":
        await deps.personalData.deleteMyData({ userId: who.userId, confirmation: str(b.confirmation, "confirmation") });
        setSession(res, null);
        return json(res, 200, { ok: true });
      case "POST /v1/billing/profile":
        return json(res, 200, await deps.billingProfile.execute({ actorId: who.userId, ...(b as object) } as never));
      case "GET /v1/invoices":
        return json(res, 200, await deps.invoices.findBySubject(billingSubjectOf(await deps.access.userOrThrow(who.userId))));
      case "GET /v1/costs":
        return json(res, 200, await deps.costReport.execute({ actorId: who.userId, from: date(url.searchParams.get("from"), "from"), to: date(url.searchParams.get("to"), "to") }));
      case "GET /v1/verification/tasks":
        return json(res, 200, await deps.verification.queue(who.userId));
      case "POST /v1/verification/documents":
        return json(res, 201, await deps.verification.uploadDocument(who.userId, { ...(b as object), publishedAt: date(b.publishedAt, "publishedAt") } as never));
      // ---- Datos reales y calidad ----
      case "POST /v1/catalog/import":
        return json(res, 200, await deps.catalog.import.execute({ actorId: who.userId, sourceId: str(b.sourceId, "sourceId") }));
      case "GET /v1/quality": {
        const since = new Date(Date.now() - 30 * 86_400_000);
        return json(res, 200, { current: deps.quality.currentVersion(), ...(await deps.quality.service.overview(who.userId)), usefulness: await deps.quality.feedback.usefulnessByVersion(since) });
      }
      case "POST /v1/quality/examples":
        return json(res, 201, await deps.quality.service.addExample({ actorId: who.userId, text: str(b.text, "text"), isSmoke: !!b.isSmoke, types: (b.types as never[]) ?? [], note: b.note as string | undefined }));
      case "POST /v1/quality/evaluate":
        return json(res, 200, await deps.quality.evaluateCurrent(who.userId));
      case "POST /v1/quality/promote":
        return json(res, 200, await deps.quality.service.promote({ actorId: who.userId, versionId: str(b.versionId, "versionId") }));
      case "POST /v1/feedback":
        return json(res, 200, await deps.quality.feedback.submit({ userId: who.userId, analysisId: str(b.analysisId, "analysisId"), useful: !!b.useful, reason: b.reason as never, comment: b.comment as string | undefined }));
      case "POST /v1/campaigns":
        return json(res, 201, await P.campaigns.create({ actorId: who.userId, ...(b as object) } as never));
      case "POST /v1/perspectives":
        return json(res, 201, await P.perspectives.publish({ actorId: who.userId, ...(b as object) } as never));
      case "GET /v1/rooms":
        return json(res, 200, await P.rooms.list(who.userId));
      case "POST /v1/rooms":
        return json(res, 201, await P.rooms.create({ actorId: who.userId, name: str(b.name, "name"), topic: b.topic as string | undefined, slowModeSeconds: b.slowModeSeconds as number | undefined }));
      case "POST /v1/rebuttals":
        return json(res, 201, await deps.rebuttals.submit({ actorId: who.userId, outletId: str(b.outletId, "outletId"), target: b.target as never, statement: str(b.statement, "statement"), evidenceUrls: b.evidenceUrls as string[] | undefined }));
      case "POST /v1/analyze": {
        const text = str(b.text, "text");
        const now = new Date();
        const a = await deps.gateway.analyzeContent(who, {
          id: randomUUID(), sourceType: b.url ? "web" : "message", origin: b.url ? { address: String(b.url), domain: new URL(String(b.url)).hostname } : {},
          text, urls: text.match(/https?:\/\/[^\s)]+/g) ?? [], publishedAt: now, receivedAt: now, attachments: [], metadata: {},
        });
        return json(res, 200, { id: a.id, smokeIndex: a.smoke.smokeIndex, facts: a.smoke.facts, findings: a.smoke.findings, cleanVersion: a.smoke.cleanVersion, signals: a.signals, links: a.links });
      }
      case "POST /v1/compare": {
        const r = await deps.gateway.compareSources(who, { topic: str(b.topic, "topic"), period: { from: date(b.from, "from"), to: date(b.to, "to") }, urlRules: b.urlRules as never });
        return json(res, 200, r);
      }
      case "POST /v1/credibility": {
        const r = await deps.gateway.evaluateCredibility(who, { outletId: str(b.outletId, "outletId"), topic: str(b.topic, "topic"), period: { from: date(b.from, "from"), to: date(b.to, "to") } });
        return json(res, 200, r);
      }
      case "GET /v1/plan": {
        const user = await deps.access.userOrThrow(who.userId);
        const { plan } = await deps.access.planOf(user);
        return json(res, 200, { plan, usage: await deps.access.usageOf(user) });
      }
      case "POST /v1/reviews":
        return json(res, 201, await deps.reviews.submit({ userId: who.userId, target: b.target as never, rating: (b.rating as number | null) ?? null, text: b.text as string | undefined }));
      case "GET /v1/reviews/summary":
        return json(res, 200, await deps.reviews.summary({ type: str(url.searchParams.get("type"), "type") as never, id: str(url.searchParams.get("id"), "id") }));
      case "POST /v1/replies":
        return json(res, 201, await deps.replies.request({ actorId: who.userId, target: b.target as never, content: b.content as never, topic: b.topic as string | undefined }));
      case "GET /v1/impact": {
        const perms = await deps.authz.permissionsOf(await deps.access.userOrThrow(who.userId));
        if (!perms.has("replies:moderate") && !perms.has("audit:read")) throw new AccessDeniedError("No tenés acceso a los reportes de impacto.", "no_permission");
        return json(res, 200, await deps.impactReport.execute({ from: date(url.searchParams.get("from"), "from"), to: date(url.searchParams.get("to"), "to") }));
      }
      default:
        throw new HttpError(404, "Ruta inexistente.");
    }
  }

  function verifyHmac(raw: Buffer, header: string, secret: string): void {
    const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
    if (!safeEqual(header, expected)) throw new HttpError(401, "Firma inválida.");
  }
}

function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    String(req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k!, decodeURIComponent(v!)]),
  );
}

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new HttpError(413, "Cuerpo demasiado grande."));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJson(raw: Buffer): unknown {
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}

/** CSV estándar para datos abiertos y BI: separador ",", comillas cuando hace falta, UTF-8. */
function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new ValidationError(`Falta "${name}".`);
  return v;
}

function date(v: unknown, name: string): Date {
  const d = new Date(str(v, name));
  if (Number.isNaN(d.getTime())) throw new ValidationError(`"${name}" no es una fecha válida.`);
  return d;
}

function toHttpError(err: unknown): [number, Record<string, unknown>] {
  if (err instanceof HttpError) return [err.status, { error: err.message }];
  if (err instanceof AccessDeniedError) return [err.code === "quota_exceeded" || err.code === "too_many_attempts" ? 429 : 403, { error: err.message, code: err.code, upgradeHint: err.upgradeHint }];
  if (err instanceof ValidationError) return [400, { error: err.message }];
  if (err instanceof NotFoundError) return [404, { error: err.message }];
  if (err instanceof ConflictError) return [409, { error: err.message }];
  return [500, { error: "Error interno." }];
}

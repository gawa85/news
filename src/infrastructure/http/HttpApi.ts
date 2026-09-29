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
 *    POST /v1/replies        { target, content, topic? }   GET /v1/replies (mías)   GET /v1/replies/pending   POST /v1/replies/:id/review { approve }
 *    GET  /v1/impact?from=&to=
 *    POST /mcp               MCP por HTTP (Streamable HTTP, sin estado)
 *
 *  Webhooks de proveedores:
 *    GET/POST /webhooks/whatsapp   (verificación + firma X-Hub-Signature-256)
 *    POST     /webhooks/telegram   (token secreto en encabezado)
 *    POST     /webhooks/payments   (firma HMAC)
 *
 *  Login web (sesión en cookie HttpOnly):
 *    POST /auth/magic-link { email, next? }   GET /auth/magic?token=  (vuelve a `next`)
 *    POST /auth/login { email, password } POST /auth/password { email, password } (con sesión)
 *    GET  /auth/:proveedor  →  GET /auth/:proveedor/callback
 *    POST /auth/logout                    POST /auth/logout-all
 *  Con sesión o clave de API también:
 *    GET  /v1/export?kind=&format=&…      GET /v1/audit?from=&to=
 *    GET/POST /v1/rebuttals (GET: por resolver)   POST /v1/rebuttals/:id/resolve
 *
 *  Mis datos (Ley 25.326):  GET /v1/me/data   POST /v1/me/delete { confirmation }
 *  Facturación:  POST /v1/billing/profile   GET /v1/invoices
 *  Costos (administración):  GET /v1/costs?from=&to=   (hasta 366 días)
 *  Verificación:  GET /v1/verification/tasks
 *    POST /v1/verification/tasks/:id/(take|suggest|evidence|resolve|discard)
 *    POST /v1/verification/documents
 *  Fe de erratas:  POST /v1/corrections { target: { type, id }, outletId?, description }   (corrections:publish)
 *  Participación:
 *    GET  /public/narratives?days=          humo en circulación
 *    GET  /public/perspectives?type=&id=    otras miradas (agrupadas por tipo)
 *    POST /v1/perspectives   POST /v1/perspectives/:id/vote
 *    POST /v1/campaigns      POST /v1/campaigns/:id/(review|launch|allies|respond)   GET /v1/campaigns/:id/report
 *    GET/POST /v1/rooms      GET /v1/rooms/:id (miembros)   POST /v1/rooms/:id/archive
 *    GET /v1/rooms/:id/events (SSE, tiempo real)   POST /v1/rooms/:id/messages { text, kind? }   POST /v1/rooms/messages/:id/delete
 *  Estadísticas:
 *    GET /v1/stats/panel?scope=user|organization&from=&to=   GET /v1/stats/business?from=&to=
 *    GET /v1/bi/:dataset?scope=&since=&limit=   (analyses | daily_stats; para Power BI, Looker, Metabase)
 *    GET/POST /v1/reports/schedules    DELETE /v1/reports/schedules/:id
 *    GET /public/observatory?month=AAAA-MM
 *    GET /public/datasets    GET /public/datasets/:id.(csv|json)?from=&to=   (datos abiertos, CC BY 4.0)
 *  Configuración del negocio:
 *    GET /public/topics                     árbol de categorías y temas
 *    GET /v1/taxonomy (con lo desactivado)   POST /v1/taxonomy/categories  POST /v1/taxonomy/topics   (taxonomy:manage)
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
 *    GET/POST /v1/classrooms   POST /v1/classrooms/join { code, alias }   GET /v1/classrooms/:id/report   POST /v1/classrooms/:id/archive
 *  Soporte:  GET/POST /v1/support/tickets   POST /v1/support/tickets/:id/(messages|reply|rate)   GET /v1/support/queue
 *  Funciones en prueba:  GET /v1/flags   PATCH /v1/flags/:key
 *  Audios firmados:  GET /media/:id?exp=&sig=
 *  Eventos en vivo:  GET /public/events   GET /public/events/:código[/stream] (SSE, sin cuenta)
 *                    GET/POST /v1/events (GET: los que modero)   POST /v1/events/:id/(close|factcheck|mute)   (events:host)
 *  Redes:  POST /v1/social/read {url}
 *  Claves de API (sólo con sesión web):  GET/POST /v1/api-keys { name, scopes }   POST /v1/api-keys/:id/revoke
 *  Organización:  GET/POST /v1/organization { name }   POST /v1/organization/invitations { email, roleId? }
 *    POST /v1/organization/invitations/:id/revoke   GET /public/invitations/:token   POST /v1/organization/join { token }
 *    PUT /v1/organization/members/:id/role { roleId }   POST /v1/organization/members/:id/remove   POST /v1/organization/leave
 *  Webhooks (sólo con sesión web):  GET/POST /v1/webhooks { url, events }   POST /v1/webhooks/:id/(test|remove)
 *  Mis fuentes:  GET/POST /v1/sources { type: rss|email, name, config, secret? }   POST /v1/sources/:id/disconnect
 *  Mis reglas de fuentes:  GET/POST /v1/rules { scope, name, urlRules }   POST /v1/rules/:id/deactivate
 *  Mis réplicas (representantes de medios):  GET /v1/rebuttals/mine
 *  Reseñas:  GET /v1/reviews/mine?type=&id=
 *  Fotos y videos:  POST /v1/media/check  (cuerpo = el archivo, content-type image/* o video/*, hasta 20 MB)
 *  Alertas:  GET/POST /v1/alerts { topic, trigger, channel, outletId? }   POST /v1/alerts/:id/deactivate
 *  Origen:  POST /v1/origin { url, topic? }   ("¿quién lo dijo primero?")
 *  Credibilidad en el tiempo:  POST /v1/credibility/timeline { outletId, topic, from, to, windows }
 *  Evidencias:  POST /v1/evidence {url, monitor}   GET /v1/evidence[?url=]   GET /v1/evidence/:id[/verify|/content?kind=raw|text]
 *  Operación:  GET/POST /v1/ops/backups   POST /v1/ops/backups/verify { key }   (ops:backup, una operación por vez)   GET /health (con el ambiente)
 *  Catálogo:  GET /v1/catalog/sources   POST /v1/catalog/import { sourceId }   POST /v1/catalog/import-csv { kind, text }
 *    POST /v1/catalog/outlets { id?, name, url, kind, region, aliases }   GET /v1/catalog/outlets/:id (con feeds y propiedad)
 *    POST /v1/catalog/outlets/:id/feeds { url }   POST /v1/catalog/outlets/:id/feeds/:feedId/(activate|deactivate)   (outlets:write)
 *  Personas (users:manage_all):  GET /v1/admin/roles   GET /v1/admin/users?q=|filter=staff|suspended   GET /v1/admin/users/:id
 *    POST /v1/admin/users/:id/(roles/add|roles/remove) { roleId }   (suspend|reactivate) { reason }   (outlets/add|outlets/remove) { outletId }
 *  Legal:  GET /public/legal   GET /v1/legal/pending   POST /v1/legal/accept { docId, version }
 *  Métricas (Prometheus, con token):  GET /metrics
 *
 *  Público:
 *    GET /r/:code   link de seguimiento → redirección
 *    GET /public/outlets/:id          ficha: dueños, pauta oficial, réplicas y fe de erratas
 *    GET /public/outlets/:id/record  réplicas y correcciones de un medio
 *    GET /public/corrections         fe de erratas
 *    GET /health
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AbuseRejectedError, AccessDeniedError, ConflictError, InsufficientDataError, NotFoundError, ValidationError } from "../../domain/errors";
import type { IAbusePolicy, RestrictionAdmin } from "../../application/abuse/AbuseGuard";
import type { IInboundHandler } from "../../application/abuse/ThrottledInbound";
import { clientIp } from "./clientIp";
import type { SocialReader } from "../../application/social/SocialReader";
import { AccountQueries } from "../../application/web/AccountQueries";
import type { AlertSettings } from "../../application/alerts/AlertSettings";
import type { OrganizationService } from "../../application/organizations/Organizations";
import type { SourceSettings } from "../../application/content/SourceSettings";
import type { ConnectSourceUseCase } from "../../application/content/SourceUseCases";
import type { RuleSetSettings } from "../../application/rules/RuleSetSettings";
import type { SaveRuleSetUseCase } from "../../application/users/UserSettingsUseCases";
import type { MediaCheckService } from "../../application/media/MediaCheck";
import type { OutletProfileService } from "../../application/catalog/OutletProfile";
import type { PlatformUsersService } from "../../application/users/PlatformUsers";
import type { OutletEditor } from "../../application/catalog/OutletEditor";
import type { CreateAlertUseCase } from "../../application/users/UserSettingsUseCases";
import type { SubscriptionLifecycle } from "../../application/billing/SubscriptionLifecycle";
import type { EventRoomService } from "../../application/participation/EventRooms";
import type { Article, OriginTrace, RoomEvent } from "../../domain/model";
import type { AccessControl } from "../../application/access/AccessControl";
import type { Caller, ProductGateway } from "../../application/access/ProductGateway";
import type { ImpactReportUseCase } from "../../application/impact/ImpactUseCases";
import type { ApiKeyService, WebhookService } from "../../application/integrations/IntegrationServices";
import type { ResponseComposer } from "../../application/messaging/ResponseComposer";
import type { ReplyService, TrackedLinkService } from "../../application/replies/ReplyService";
import type { ReviewService } from "../../application/reviews/ReviewService";
import type { ConfirmPaymentUseCase } from "../../application/users/PlansUseCases";
import type { AuthService } from "../../application/auth/AuthService";
import type { AuditQueryUseCase } from "../../application/audit/Audit";
import type { ExportRequest, ExportService } from "../../application/exports/ExportService";
import type { AssignOutletRepresentativeUseCase, RebuttalService } from "../../application/rebuttals/Rebuttals";
import type { ExportFormat } from "../../domain/model";
import type { SetBillingProfileUseCase } from "../../application/billing/Invoicing";
import type { CostReportUseCase } from "../../application/costs/Costs";
import type { VerificationDesk } from "../../application/factcheck/VerificationDesk";
import type { PersonalDataService } from "../../application/privacy/PersonalData";
import type { IClock, IInvoiceRepository, IOutletCatalogSource } from "../../domain/ports";
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
import type { EvidenceService } from "../../application/evidence/Evidence";
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
  /** Administración de cuentas de la plataforma y representantes de medios. */
  users: { platform: PlatformUsersService; assignOutletRepresentative: AssignOutletRepresentativeUseCase };
  access: AccessControl;
  authz: IAuthorizationService;
  apiKeys: ApiKeyService;
  composer: ResponseComposer;
  replies: ReplyService;
  reviews: ReviewService;
  impactReport: ImpactReportUseCase;
  trackedLinks: TrackedLinkService;
  /** Mensajes de chat (con el freno contra el abuso delante). */
  inbound: IInboundHandler;
  /** Lector de publicaciones de redes. */
  social?: SocialReader;
  /** Consultas de la web de personas (quién soy, historial, planes, medios). */
  account?: AccountQueries;
  /** Reloj de la plataforma (por defecto, el del sistema). */
  clock?: IClock;
  /** Ficha pública de cada medio (dueños, pauta oficial, réplicas y fe de erratas). */
  outletProfiles?: OutletProfileService;
  /** Revisar fotos y videos (¿ya circularon?, ¿qué dicen sus datos?). */
  mediaCheck?: MediaCheckService;
  /** Webhooks salientes: ver, crear, probar y apagar. */
  webhooks?: WebhookService;
  /** Mis fuentes: ver, conectar (se prueba antes) y desconectar. */
  sources?: { settings: SourceSettings; connect: ConnectSourceUseCase };
  /** Mis reglas de fuentes (personales y de la organización). */
  ruleSets?: { settings: RuleSetSettings; save: SaveRuleSetUseCase };
  /** Mi organización: equipo, invitaciones y roles. */
  organizations?: OrganizationService;
  /** Mis alertas: ver, crear y apagar. */
  alerts?: { settings: AlertSettings; create: CreateAlertUseCase };
  /** Cancelar o retomar la suscripción. */
  lifecycle?: SubscriptionLifecycle;
  /** Freno contra el abuso (API, MCP). Sin él, no se limita. */
  abuse?: IAbusePolicy;
  restrictions?: RestrictionAdmin;
  /** Proxies de confianza (IPs o rangos IPv4): sólo a ellos se les cree X-Forwarded-For. */
  trustedProxies?: string[];
  /** Captcha que tiene que mostrar la web (clave pública). */
  captcha?: { provider: string; siteKey: string };
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
  participation: { narratives: NarrativeTracker; campaigns: CampaignService; perspectives: PerspectiveService; rooms: RoomService; events: EventRoomService };
  /** `csvSource`: arma una fuente con un CSV subido desde la web (medios, propiedad o pauta). */
  catalog: { import: ImportCatalogUseCase; editor: OutletEditor; csvSource?: (kind: "outlets" | "ownership" | "advertising", label: string, text: string) => IOutletCatalogSource };
  stats: { service: StatsService; openData: OpenDataService; biFeed: BiFeedService; scheduledReports: ScheduledReportService };
  config: { taxonomy: TaxonomyService; preferences: PreferencesService; businessRules: BusinessRulesService; params: ParameterService };
  commerce: { service: CommerceService; referrals: ReferralService; branding: BrandingService; countries: ICountryRegistry };
  inclusion: { learning: LearningService; media: IMediaStore };
  flags: FeatureFlagService;
  support: SupportService;
  evidence: EvidenceService;
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

/** Fotos y videos para revisar (el cuerpo es el archivo; el tipo, el content-type). */
const MEDIA_MAX_BYTES = 20 * 1024 * 1024;

export function createHttpApi(deps: HttpApiDeps): Server {
  // Un solo reloj para toda la plataforma (límites, fechas por defecto): el de las pruebas es manual.
  const now = () => deps.clock?.now() ?? new Date();
  const maxBody = deps.maxBodyBytes ?? 1_000_000;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      // PUT y PATCH también traen cuerpo (antes se ignoraba: preferencias y país no se guardaban).
      // Revisar una foto o un video es el único pedido que trae un archivo grande.
      const limit = url.pathname === "/v1/media/check" ? MEDIA_MAX_BYTES : maxBody;
      const raw = ["POST", "PUT", "PATCH"].includes(req.method ?? "") ? await readBody(req, limit) : Buffer.alloc(0);
      await route(req, res, url, raw);
    } catch (err) {
      const [status, body] = toHttpError(err);
      if (err instanceof AbuseRejectedError) {
        if (err.retryAfterSeconds && !res.headersSent) res.setHeader("retry-after", String(err.retryAfterSeconds));
        if (err.code === "captcha_required" && deps.captcha) body.captcha = deps.captcha;
      }
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
    if (req.method !== "GET" && req.method !== "HEAD") requireSameOrigin(req, true);
    return deps.auth.authenticateSession(session);
  }

  /**
   * CSRF: un pedido que cambia algo con la cookie tiene que venir del propio sitio. Se compara
   * el ORIGEN EXACTO (esquema + dominio + puerto): antes, "sinhumo.com.atacante.com" pasaba
   * por empezar igual. `required`: sin Origin ni Referer también se rechaza.
   */
  function requireSameOrigin(req: IncomingMessage, required: boolean): void {
    const raw = String(req.headers.origin ?? req.headers.referer ?? "");
    if (!raw) {
      if (required) throw new HttpError(403, "Origen no permitido.");
      return;
    }
    let origin: string;
    try {
      origin = new URL(raw).origin;
    } catch {
      throw new HttpError(403, "Origen no permitido.");
    }
    if (origin !== new URL(deps.publicBaseUrl).origin) throw new HttpError(403, "Origen no permitido.");
  }

  function setSession(res: ServerResponse, token: string | null): void {
    const secure = deps.publicBaseUrl.startsWith("https://") ? "; Secure" : "";
    res.setHeader("set-cookie", token
      ? `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86_400}${secure}`
      : `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
  }

  function meta(req: IncomingMessage, captchaToken?: unknown) {
    const header = req.headers["x-captcha-token"];
    const token = typeof captchaToken === "string" ? captchaToken : typeof header === "string" ? header : undefined;
    return { userAgent: String(req.headers["user-agent"] ?? ""), ip: clientIp(req, deps.trustedProxies ?? []), ...(token ? { captchaToken: token } : {}) };
  }

  /**
   * Server-Sent Events: el navegador mantiene la conexión y recibe cada novedad de la sala.
   * Primero se entra (si falla, responde el error como JSON); después, historial y novedades.
   */
  async function stream(req: IncomingMessage, res: ServerResponse, join: (send: (e: RoomEvent) => void) => Promise<{ history: unknown[]; leave: () => void }>): Promise<void> {
    const pending: RoomEvent[] = [];
    let open = false;
    const send = (e: unknown) => (open ? res.write(`data: ${JSON.stringify(e)}\n\n`) : pending.push(e as RoomEvent));
    const { history, leave } = await join(send);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    open = true;
    send({ type: "history", messages: history });
    pending.splice(0).forEach(send);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(ping);
      leave();
    });
  }

  /** Frecuencia de la API y el MCP, por persona y por red. */
  async function limitApi(req: IncomingMessage, who: Caller): Promise<void> {
    await deps.abuse?.enforce({ action: "api_request", at: now(), userId: who.userId, ip: clientIp(req, deps.trustedProxies ?? []) });
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL, raw: Buffer): Promise<void> {
    const path = url.pathname;
    const body = () => parseJson(raw);

    if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true, environment: deps.environment ?? "development" });
    // ---- Eventos en vivo: se leen sin cuenta (para insertarlos en el sitio de un medio) ----
    if (req.method === "GET" && path === "/public/events") return json(res, 200, await deps.participation.events.list(Number(url.searchParams.get("limit") ?? 20)));
    const pubEv = path.match(/^\/public\/events\/([A-Za-z0-9_-]+)(\/stream)?$/);
    if (req.method === "GET" && pubEv) {
      const ev = await deps.participation.events.get(decodeURIComponent(pubEv[1]!));
      if (!pubEv[2]) return json(res, 200, ev);
      return stream(req, res, (send) => deps.participation.rooms.join({ roomId: ev.id }, send));
    }
    // Portada y precios: planes para personas y medios del catálogo.
    if (req.method === "GET" && path === "/public/plans") return json(res, 200, await need(deps.account).publicPlans());
    if (req.method === "GET" && path === "/public/outlets") return json(res, 200, await need(deps.account).publicOutlets());
    // Pantalla de acceso: qué proveedores hay (Google…) y qué captcha mostrar.
    const invPrev = path.match(/^\/public\/invitations\/([A-Za-z0-9_-]{16,64})$/);
    if (req.method === "GET" && invPrev) return json(res, 200, await need(deps.organizations).preview(invPrev[1]!));
    if (req.method === "GET" && path === "/public/auth-options") return json(res, 200, { providers: deps.auth.providerIds(), captcha: deps.captcha ?? null });
    // Qué captcha mostrar en las pantallas de alta y acceso (sólo la clave pública).
    if (req.method === "GET" && path === "/public/captcha") return json(res, 200, deps.captcha ?? { provider: null });

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
    const outletM = path.match(/^\/public\/outlets\/([^/]+)$/);
    if (req.method === "GET" && outletM) return json(res, 200, await need(deps.outletProfiles).profile(decodeURIComponent(outletM[1]!)));
    const record = path.match(/^\/public\/outlets\/([^/]+)\/record$/);
    if (req.method === "GET" && record) return json(res, 200, await deps.rebuttals.publicRecord(decodeURIComponent(record[1]!)));
    if (req.method === "GET" && path === "/public/corrections") return json(res, 200, await deps.rebuttals.recentCorrections());
    if (req.method === "GET" && path === "/public/narratives") {
      const days = Math.min(90, Number(url.searchParams.get("days") ?? 7));
      return json(res, 200, (await deps.participation.narratives.top(days)).map(({ campaignIds, ...n }) => ({ ...n, countered: campaignIds.length > 0 })));
    }
    if (req.method === "GET" && path === "/public/observatory") {
      const month = url.searchParams.get("month") ?? now().toISOString().slice(0, 7);
      return json(res, 200, await deps.stats.service.observatory(month));
    }
    if (req.method === "GET" && path === "/public/datasets") return json(res, 200, deps.stats.openData.list());
    if (req.method === "GET" && path === "/public/topics") return json(res, 200, await deps.config.taxonomy.publicTree());
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
      const to = url.searchParams.get("to") ? date(url.searchParams.get("to"), "to") : now();
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
        const b = body() as { email?: string; captchaToken?: string; next?: string };
        // Sólo rutas del propio sitio (si no, el enlace del mail sería una redirección abierta).
        const next = typeof b.next === "string" && localPath(b.next) && b.next.length <= 500 ? b.next : undefined;
        await deps.auth.requestMagicLink(str(b.email, "email"), meta(req, b.captchaToken), next);
        return json(res, 200, { ok: true, message: "Si el mail es válido, te llegó un enlace para entrar." });
      }
      if (req.method === "GET" && path === "/auth/magic") {
        // Es un link que se abre desde el mail: si falla, se vuelve a la web con el aviso (no un JSON).
        try {
          const { token, next } = await deps.auth.consumeMagicLink(str(url.searchParams.get("token"), "token"), meta(req));
          setSession(res, token);
          res.writeHead(302, { location: next && localPath(next) ? next : "/" }).end();
        } catch (e) {
          if (!(e instanceof AccessDeniedError || e instanceof ValidationError)) throw e;
          res.writeHead(302, { location: "/entrar?error=enlace" }).end();
        }
        return;
      }
      if (req.method === "POST" && path === "/auth/login") {
        // Un navegador siempre manda Origin en un POST: si es de otro sitio, es un intento de
        // hacer entrar a la persona en una cuenta ajena ("login CSRF"). Sin Origin (programas), pasa.
        requireSameOrigin(req, false);
        const b = body() as { email?: string; password?: string; captchaToken?: string };
        const { token, user } = await deps.auth.loginWithPassword(str(b.email, "email"), str(b.password, "password"), meta(req, b.captchaToken));
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
      // (logout y los demás nombres propios de /auth no son proveedores)
      const oauth = path.match(/^\/auth\/(?!logout|login|magic|password)([a-z]+)(\/callback)?$/);
      if (req.method === "GET" && oauth) {
        if (!oauth[2]) {
          const next = url.searchParams.get("next") ?? undefined;
          res.writeHead(302, { location: await deps.auth.startOAuth(oauth[1]!, next && localPath(next) ? next : undefined) }).end();
          return;
        }
        try {
          const r = await deps.auth.completeOAuth(oauth[1]!, str(url.searchParams.get("state"), "state"), str(url.searchParams.get("code"), "code"), meta(req));
          setSession(res, r.token);
          res.writeHead(302, { location: r.redirectAfter && localPath(r.redirectAfter) ? r.redirectAfter : "/" }).end();
        } catch (e) {
          if (!(e instanceof AccessDeniedError || e instanceof ValidationError)) throw e;
          res.writeHead(302, { location: "/entrar?error=google" }).end();
        }
        return;
      }
      throw new HttpError(404, "Ruta inexistente.");
    }

    // ---- Webhooks de proveedores ----
    if (path === "/webhooks/whatsapp") {
      if (req.method === "GET") {
        const ok = url.searchParams.get("hub.mode") === "subscribe" && safeEqual(url.searchParams.get("hub.verify_token") ?? "", configured(deps.secrets.whatsappVerifyToken, "WhatsApp"));
        if (!ok) throw new HttpError(403, "Token de verificación inválido.");
        res.writeHead(200, { "content-type": "text/plain" }).end(url.searchParams.get("hub.challenge") ?? "");
        return;
      }
      verifyHmac(raw, String(req.headers["x-hub-signature-256"] ?? ""), configured(deps.secrets.whatsappAppSecret, "WhatsApp"));
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
      if (!safeEqual(String(req.headers["x-telegram-bot-api-secret-token"] ?? ""), configured(deps.secrets.telegramSecretToken, "Telegram"))) throw new HttpError(403, "Token inválido.");
      const msg = deps.parsers.telegram.parse(body());
      json(res, 200, { ok: true });
      if (msg) deps.inbound.execute(msg).catch((e) => deps.logger.error("Falló un mensaje de Telegram", { error: String(e) }));
      return;
    }
    if (req.method === "POST" && path === "/webhooks/payments") {
      verifyHmac(raw, String(req.headers["x-signature"] ?? ""), configured(deps.secrets.paymentsSecret, "Pagos"));
      const { subscriptionId } = body() as { subscriptionId?: string };
      if (!subscriptionId) throw new ValidationError("Falta subscriptionId.");
      const sub = await deps.confirmPayment.execute({ subscriptionId });
      return json(res, 200, { ok: true, status: sub.status });
    }

    // ---- MCP por HTTP ----
    if (path === "/mcp") {
      if (req.method !== "POST") throw new HttpError(405, "Usá POST.");
      const who = await caller(req);
      await limitApi(req, who);
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
    await limitApi(req, who);
    // (La revisión de fotos y videos trae el archivo como cuerpo, no JSON.)
    const b = ["POST", "PUT", "PATCH"].includes(req.method ?? "") && path !== "/v1/media/check" ? (body() as Record<string, unknown>) : {};

    // ---- Restricciones contra el abuso (soporte y administración) ----
    const rstM = path.match(/^\/v1\/abuse\/restrictions\/([^/]+)\/lift$/);
    if (req.method === "POST" && rstM) return json(res, 200, await need(deps.restrictions).lift({ actorId: who.userId, id: decodeURIComponent(rstM[1]!) }));
    if (path === "/v1/abuse/restrictions") {
      if (req.method === "GET") return json(res, 200, await need(deps.restrictions).list(who.userId, Number(url.searchParams.get("limit") ?? 100)));
      if (req.method === "POST") {
        const target = { kind: str(b.kind, "kind") as never, value: str(b.value, "value") };
        return json(res, 201, await need(deps.restrictions).restrict({ actorId: who.userId, target, level: b.level === "challenge" ? "challenge" : "block", reason: str(b.reason, "reason"), hours: typeof b.hours === "number" ? b.hours : undefined }));
      }
    }

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
    if (req.method === "GET" && path === "/v1/campaigns") return json(res, 200, { campaigns: await P.campaigns.list(who.userId), channels: P.campaigns.channelOptions() });
    if (req.method === "GET" && path === "/v1/replies") return json(res, 200, await deps.replies.mine(who.userId));
    if (req.method === "GET" && path === "/v1/replies/pending") return json(res, 200, await deps.replies.pendingFor(who.userId));
    const replyRev = path.match(/^\/v1\/replies\/([^/]+)\/review$/);
    if (req.method === "POST" && replyRev) return json(res, 200, await deps.replies.review({ moderatorId: who.userId, draftId: decodeURIComponent(replyRev[1]!), approve: b.approve === true }));
    const camp = path.match(/^\/v1\/campaigns\/([^/]+)\/(review|launch|allies|respond|report)$/);
    if (camp) {
      const id = decodeURIComponent(camp[1]!);
      switch (`${req.method} ${camp[2]}`) {
        case "POST review": return json(res, 200, await P.campaigns.review({ actorId: who.userId, campaignId: id, approve: !!b.approve, note: str(b.note, "note"), political: b.political as boolean | undefined }));
        case "POST launch": return json(res, 200, await P.campaigns.launch({ actorId: who.userId, campaignId: id }));
        case "POST allies": return json(res, 200, { invited: await P.campaigns.inviteAllies({ actorId: who.userId, campaignId: id, userIds: (b.userIds as string[]) ?? [] }) });
        case "POST respond": return json(res, 200, await P.campaigns.respondAlly({ userId: who.userId, campaignId: id, accept: !!b.accept }).then(() => ({ ok: true })));
        case "GET report": return json(res, 200, await P.campaigns.report({ actorId: who.userId, campaignId: id }));
      }
    }
    const couponM = path.match(/^\/v1\/coupons\/([A-Za-z0-9-]+)\/deactivate$/);
    if (req.method === "POST" && couponM) {
      await deps.commerce.service.deactivateCoupon({ actorId: who.userId, code: couponM[1]! });
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && path === "/v1/classrooms") return json(res, 200, await deps.inclusion.learning.classrooms(who.userId));
    const classArch = path.match(/^\/v1\/classrooms\/([^/]+)\/archive$/);
    if (req.method === "POST" && classArch) {
      await deps.inclusion.learning.archiveClassroom({ teacherId: who.userId, classroomId: decodeURIComponent(classArch[1]!) });
      return json(res, 200, { ok: true });
    }
    const classM = path.match(/^\/v1\/classrooms\/([^/]+)\/report$/);
    if (req.method === "GET" && classM) return json(res, 200, await deps.inclusion.learning.report({ teacherId: who.userId, classroomId: decodeURIComponent(classM[1]!) }));
    const anM = path.match(/^\/v1\/me\/analyses\/([^/]+)$/);
    if (req.method === "GET" && anM) return json(res, 200, await need(deps.account).analysis(who.userId, decodeURIComponent(anM[1]!)));
    const evM = path.match(/^\/v1\/evidence\/([^/]+)(?:\/(verify|content))?$/);
    if (req.method === "GET" && evM) {
      const id = decodeURIComponent(evM[1]!);
      if (evM[2] === "verify") return json(res, 200, await deps.evidence.verify(who.userId, id));
      if (evM[2] === "content") {
        const kind = url.searchParams.get("kind") === "text" ? "text" : "raw";
        const f = await deps.evidence.content(who.userId, id, kind);
        // Se descarga, nunca se muestra: el HTML archivado no puede correr en nuestro dominio.
        return void res.writeHead(200, {
          "content-type": kind === "text" ? f.mime : "application/octet-stream",
          "content-disposition": `attachment; filename="evidencia-${id.replace(/[^\w-]/g, "")}.${kind === "text" ? "txt" : "bin"}"`,
          "x-content-type-options": "nosniff",
          "content-security-policy": "sandbox; default-src 'none'",
          "content-length": String(f.data.length),
        }).end(f.data);
      }
      return json(res, 200, await deps.evidence.get(who.userId, id));
    }
    const tkt = path.match(/^\/v1\/support\/tickets\/([^/]+)\/(messages|reply|rate)$/);
    if (req.method === "POST" && tkt) {
      const ticketId = decodeURIComponent(tkt[1]!);
      if (tkt[2] === "messages") return json(res, 200, await deps.support.addFromRequester({ userId: who.userId, ticketId, text: str(b.text, "text") }));
      if (tkt[2] === "rate") return json(res, 200, await deps.support.rate({ userId: who.userId, ticketId, score: Number(b.score) }).then(() => ({ ok: true })));
      return json(res, 200, await deps.support.reply({ agentId: who.userId, ticketId, text: str(b.text, "text"), internal: !!b.internal, status: b.status as never }));
    }
    const flagM = path.match(/^\/v1\/flags\/([a-z0-9_]+)$/);
    if (req.method === "PATCH" && flagM) return json(res, 200, await deps.flags.update({ ...pick(b, ["enabled", "rolloutPercent", "allowUsers", "allowOrgs", "plans", "countries"]), actorId: who.userId, key: flagM[1]! } as never));
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
    // ---- Medios del catálogo (outlets:write) ----
    const om = path.match(/^\/v1\/catalog\/outlets(?:\/([^/]+)(?:\/feeds(?:\/([^/]+)\/(activate|deactivate))?)?)?$/);
    if (om) {
      const ed = deps.catalog.editor;
      const id = om[1] ? decodeURIComponent(om[1]) : undefined;
      if (req.method === "POST" && !id) {
        return json(res, 200, await ed.save(who.userId, { ...pick(b, ["id", "name", "url", "kind", "aliases"]), region: (typeof b.region === "object" && b.region ? pick(b.region as Record<string, unknown>, ["country", "province", "locality"]) : {}) } as never));
      }
      if (id && req.method === "GET" && !path.endsWith("/feeds")) return json(res, 200, await ed.get(who.userId, id));
      if (id && req.method === "POST" && path.endsWith("/feeds")) return json(res, 201, await ed.addFeed(who.userId, id, str(b.url, "url")));
      if (id && req.method === "POST" && om[2]) return json(res, 200, await ed.setFeedActive(who.userId, id, decodeURIComponent(om[2]), om[3] === "activate"));
    }
    // ---- Personas de la plataforma (users:manage_all) ----
    if (path.startsWith("/v1/admin/")) {
      const pu = deps.users.platform;
      if (req.method === "GET" && path === "/v1/admin/roles") return json(res, 200, await pu.roleCatalog(who.userId));
      if (req.method === "GET" && path === "/v1/admin/users") {
        const f = url.searchParams.get("filter");
        return json(res, 200, await pu.search(who.userId, { q: url.searchParams.get("q") ?? undefined, filter: f === "suspended" ? "suspended" : "staff" }));
      }
      const au = path.match(/^\/v1\/admin\/users\/([^/]+)(?:\/(roles\/add|roles\/remove|suspend|reactivate|outlets\/add|outlets\/remove))?$/);
      if (au) {
        const id = decodeURIComponent(au[1]!);
        if (req.method === "GET" && !au[2]) return json(res, 200, await pu.detail(who.userId, id));
        if (req.method === "POST") {
          switch (au[2]) {
            case "roles/add":
              return json(res, 200, await pu.addRole(who.userId, id, str(b.roleId, "roleId")));
            case "roles/remove":
              return json(res, 200, await pu.removeRole(who.userId, id, str(b.roleId, "roleId")));
            case "suspend":
              return json(res, 200, await pu.suspend(who.userId, id, str(b.reason, "reason")));
            case "reactivate":
              return json(res, 200, await pu.reactivate(who.userId, id, str(b.reason, "reason")));
            case "outlets/add":
              await deps.users.assignOutletRepresentative.execute({ actorId: who.userId, targetId: id, outletId: str(b.outletId, "outletId") });
              return json(res, 200, await pu.detail(who.userId, id));
            case "outlets/remove":
              await deps.users.assignOutletRepresentative.revoke({ actorId: who.userId, targetId: id, outletId: str(b.outletId, "outletId") });
              return json(res, 200, await pu.detail(who.userId, id));
          }
        }
      }
    }
    const qrev = path.match(/^\/v1\/quality\/examples\/([^/]+)\/review$/);
    if (req.method === "POST" && qrev) {
      return json(res, 200, await deps.quality.service.reviewExample({ actorId: who.userId, exampleId: decodeURIComponent(qrev[1]!), isSmoke: !!b.isSmoke, types: (b.types as never[]) ?? [] }));
    }
    const pvote = path.match(/^\/v1\/perspectives\/(.+)\/vote$/);
    if (req.method === "POST" && pvote) return json(res, 200, await P.perspectives.vote({ actorId: who.userId, perspectiveId: decodeURIComponent(pvote[1]!), helpful: !!b.helpful }));
    // ---- Eventos en vivo: gestión (events:host) ----
    if (req.method === "POST" && path === "/v1/events") {
      return json(res, 201, await P.events.create({
        actorId: who.userId, title: str(b.title, "title"), description: b.description as string | undefined, host: b.host as string | undefined,
        startsAt: date(b.startsAt, "startsAt"), endsAt: date(b.endsAt, "endsAt"), slowModeSeconds: b.slowModeSeconds as number | undefined,
      }));
    }
    const evAct = path.match(/^\/v1\/events\/([^/]+)\/(close|factcheck|mute)$/);
    if (req.method === "POST" && evAct) {
      const roomId = decodeURIComponent(evAct[1]!);
      if (evAct[2] === "close") return json(res, 200, await P.events.close({ actorId: who.userId, roomId }));
      if (evAct[2] === "factcheck") return json(res, 201, await P.events.factCheck({ actorId: who.userId, roomId, text: str(b.text, "text") }));
      return json(res, 200, await P.events.mute({ actorId: who.userId, messageId: str(b.messageId, "messageId"), minutes: Number(b.minutes ?? 30), removeMessage: b.remove === true }));
    }
    const msgDel = path.match(/^\/v1\/rooms\/messages\/([^/]+)\/delete$/);
    if (req.method === "POST" && msgDel) {
      await P.rooms.remove({ actorId: who.userId, messageId: decodeURIComponent(msgDel[1]!) });
      return json(res, 200, { ok: true });
    }
    const roomOne = path.match(/^\/v1\/rooms\/([^/]+)(\/archive)?$/);
    if (roomOne && roomOne[1] !== "messages") {
      const roomId = decodeURIComponent(roomOne[1]!);
      if (req.method === "GET" && !roomOne[2]) return json(res, 200, await P.rooms.details({ actorId: who.userId, roomId }));
      if (req.method === "POST" && roomOne[2]) return json(res, 200, await P.rooms.archive({ actorId: who.userId, roomId }));
    }
    const room = path.match(/^\/v1\/rooms\/([^/]+)\/(events|messages)$/);
    if (room) {
      const roomId = decodeURIComponent(room[1]!);
      if (req.method === "POST" && room[2] === "messages") {
        return json(res, 201, await P.rooms.post({ actorId: who.userId, roomId, text: str(b.text, "text"), replyTo: b.replyTo as string | undefined, kind: b.kind === "verificacion" ? "verificacion" : undefined }));
      }
      if (req.method === "GET" && room[2] === "events") return stream(req, res, (send) => P.rooms.join({ actorId: who.userId, roomId }, send));
    }

    // ---- Claves de API: sólo con la sesión de la web (una clave filtrada no puede crear más claves) ----
    if (path === "/v1/api-keys" || path.startsWith("/v1/api-keys/")) {
      if (who.channel !== "web") throw new AccessDeniedError("Las claves de API se administran desde la web.", "no_permission");
      if (req.method === "GET" && path === "/v1/api-keys") return json(res, 200, await deps.apiKeys.list(who.userId));
      if (req.method === "POST" && path === "/v1/api-keys") {
        const scopes = Array.isArray(b.scopes) ? b.scopes.map(String) : [];
        if (!scopes.length) throw new ValidationError("Elegí al menos un permiso para la clave.");
        const { plaintext, key } = await deps.apiKeys.create({ actorId: who.userId, name: str(b.name, "name").slice(0, 60), scopes: scopes as never });
        const { hash: _hash, userId: _user, ...shown } = key;
        return json(res, 201, { plaintext, key: shown });
      }
      const revoke = path.match(/^\/v1\/api-keys\/([^/]+)\/revoke$/);
      if (req.method === "POST" && revoke) {
        await deps.apiKeys.revoke({ actorId: who.userId, keyId: decodeURIComponent(revoke[1]!) });
        return json(res, 200, { ok: true });
      }
    }
    // ---- Mis fuentes (buzón IMAP, feeds RSS) ----
    if (req.method === "GET" && path === "/v1/sources") return json(res, 200, await need(deps.sources).settings.list(who.userId));
    if (req.method === "POST" && path === "/v1/sources") {
      const type = str(b.type, "type");
      if (type !== "rss" && type !== "email") throw new ValidationError("Por ahora se conectan feeds (rss) y buzones de mail (email).");
      const config = Object.fromEntries(Object.entries((b.config ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, (v as string).trim()]));
      const c = await need(deps.sources).connect.execute({ actorId: who.userId, type, name: str(b.name, "name").trim().slice(0, 80), config, secret: typeof b.secret === "string" && b.secret ? b.secret : undefined });
      const { secretRef: _s, userId: _u, cursor: _c, ...shown } = c;
      return json(res, 201, shown);
    }
    const srcOff = path.match(/^\/v1\/sources\/([^/]+)\/disconnect$/);
    if (req.method === "POST" && srcOff) {
      await need(deps.sources).settings.disconnect({ actorId: who.userId, connectionId: decodeURIComponent(srcOff[1]!) });
      return json(res, 200, { ok: true });
    }
    // ---- Mis reglas de fuentes ----
    if (req.method === "GET" && path === "/v1/rules") return json(res, 200, await need(deps.ruleSets).settings.list(who.userId));
    if (req.method === "POST" && path === "/v1/rules") {
      const list = (v: unknown) => (Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 100) : undefined);
      const rules = (b.urlRules ?? {}) as Record<string, unknown>;
      return json(res, 201, await need(deps.ruleSets).save.execute({
        actorId: who.userId, scope: b.scope === "organization" ? "organization" : "user", name: str(b.name, "name").trim().slice(0, 80),
        urlRules: { include: list(rules.include), onlyFrom: list(rules.onlyFrom), exclude: list(rules.exclude) },
      }));
    }
    const ruleOff = path.match(/^\/v1\/rules\/([^/]+)\/deactivate$/);
    if (req.method === "POST" && ruleOff) {
      await need(deps.ruleSets).settings.deactivate({ actorId: who.userId, ruleSetId: decodeURIComponent(ruleOff[1]!) });
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && path === "/v1/rebuttals/mine") return json(res, 200, await deps.rebuttals.mine(who.userId));

    // ---- Mi organización ----
    const orgInv = path.match(/^\/v1\/organization\/invitations\/([^/]+)\/revoke$/);
    if (req.method === "POST" && orgInv) {
      await need(deps.organizations).revokeInvitation({ actorId: who.userId, invitationId: decodeURIComponent(orgInv[1]!) });
      return json(res, 200, { ok: true });
    }
    const orgMember = path.match(/^\/v1\/organization\/members\/([^/]+)\/(role|remove)$/);
    if (orgMember) {
      const memberId = decodeURIComponent(orgMember[1]!);
      if (req.method === "PUT" && orgMember[2] === "role") return json(res, 200, await need(deps.organizations).setRole({ actorId: who.userId, memberId, roleId: str(b.roleId, "roleId") }));
      if (req.method === "POST" && orgMember[2] === "remove") return json(res, 200, await need(deps.organizations).removeMember({ actorId: who.userId, memberId }));
    }

    // ---- Webhooks: sólo con la sesión de la web (una clave filtrada no puede desviar los avisos) ----
    if (path === "/v1/webhooks" || path.startsWith("/v1/webhooks/")) {
      if (who.channel !== "web") throw new AccessDeniedError("Los webhooks se administran desde la web.", "no_permission");
      const W = need(deps.webhooks);
      if (req.method === "GET" && path === "/v1/webhooks") return json(res, 200, await W.list(who.userId));
      if (req.method === "POST" && path === "/v1/webhooks") {
        const events = Array.isArray(b.events) ? b.events.map(String) : [];
        const { subscription, signingSecret } = await W.register({ actorId: who.userId, url: str(b.url, "url").trim(), events: events as never });
        const { secretRef: _s, userId: _u, ...shown } = subscription;
        return json(res, 201, { webhook: shown, signingSecret });
      }
      const wh = path.match(/^\/v1\/webhooks\/([^/]+)\/(test|remove)$/);
      if (req.method === "POST" && wh) {
        const webhookId = decodeURIComponent(wh[1]!);
        if (wh[2] === "test") return json(res, 200, await W.test({ actorId: who.userId, webhookId }));
        await W.deactivate({ actorId: who.userId, webhookId });
        return json(res, 200, { ok: true });
      }
    }

    // ---- Revisar una foto o un video (el cuerpo es el archivo) ----
    if (req.method === "POST" && path === "/v1/media/check") {
      const mime = String(req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (!/^(image|video)\//.test(mime)) throw new ValidationError("Mandá una foto o un video.");
      if (!raw.length) throw new ValidationError("El archivo está vacío.");
      await deps.abuse?.enforce({ action: "expensive", at: now(), userId: who.userId });
      const { inspection: i, ...report } = await need(deps.mediaCheck).check({ data: raw, mime }, { channel: "web" });
      return json(res, 200, { ...report, file: { width: i.width, height: i.height, capturedAt: i.capturedAt, device: i.device, software: i.software, seconds: i.seconds } });
    }

    const alertOff = path.match(/^\/v1\/alerts\/([^/]+)\/deactivate$/);
    if (req.method === "POST" && alertOff) return json(res, 200, await need(deps.alerts).settings.deactivate({ actorId: who.userId, alertId: decodeURIComponent(alertOff[1]!) }));

    if (req.method === "GET" && path === "/v1/rebuttals") return json(res, 200, await deps.rebuttals.pending(who.userId));
    if (req.method === "GET" && path === "/v1/events") return json(res, 200, await P.events.hosted(who.userId));
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
        return json(res, 200, await deps.config.taxonomy.saveCategory({ ...pick(b, ["id", "name", "parentId", "description", "order", "active"]), actorId: who.userId } as never));
      case "POST /v1/taxonomy/topics":
        return json(res, 200, await deps.config.taxonomy.saveTopic({ ...pick(b, ["id", "name", "categoryId", "keywords", "synonyms", "sensitive", "countries", "active"]), actorId: who.userId } as never));
      case "GET /v1/taxonomy":
        return json(res, 200, await deps.config.taxonomy.adminTree(who.userId));
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
          ...(b as object), actorId: who.userId,
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
        return json(res, 201, await deps.backups.createManual(who.userId));
      }
      case "POST /v1/ops/backups/verify": {
        if (!deps.backups) throw new HttpError(404, "Copias de seguridad sin configurar.");
        return json(res, 200, await deps.backups.verifyListed(who.userId, str(b.key, "key")));
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
          ...(b as object), actorId: who.userId, validFrom: b.validFrom ? date(b.validFrom, "validFrom") : undefined, validTo: b.validTo ? date(b.validTo, "validTo") : undefined,
        } as never));
      case "GET /v1/coupons":
        return json(res, 200, await deps.commerce.service.listCoupons(who.userId));
      case "GET /v1/organization/branding":
        return json(res, 200, await deps.commerce.branding.mine(who.userId));
      case "GET /v1/referrals":
        return json(res, 200, await deps.commerce.referrals.summary(who.userId));
      case "POST /v1/referrals/apply":
        return json(res, 200, await deps.commerce.referrals.apply({ userId: who.userId, code: str(b.code, "code") }));
      case "PUT /v1/organization/branding":
        return json(res, 200, await deps.commerce.branding.update({ ...(b as object), actorId: who.userId } as never));
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
      case "POST /v1/social/read":
        return json(res, 200, await need(deps.social).read(str(b.url, "url")));
      case "POST /v1/evidence":
        return json(res, 201, (await deps.evidence.capture({ actorId: who.userId, url: str(b.url, "url"), monitor: b.monitor === true })).snapshot);
      case "GET /v1/evidence": {
        const u = url.searchParams.get("url");
        return json(res, 200, u ? await deps.evidence.history(who.userId, u) : await deps.evidence.listMine(who.userId, Number(url.searchParams.get("limit") ?? 50)));
      }
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
        return json(res, 200, await deps.billingProfile.execute({ ...(b as object), actorId: who.userId } as never));
      case "GET /v1/invoices":
        return json(res, 200, await deps.invoices.findBySubject(billingSubjectOf(await deps.access.userOrThrow(who.userId))));
      case "GET /v1/costs":
        return json(res, 200, await deps.costReport.execute({ actorId: who.userId, from: date(url.searchParams.get("from"), "from"), to: date(url.searchParams.get("to"), "to") }));
      case "GET /v1/verification/tasks":
        return json(res, 200, await deps.verification.queue(who.userId));
      case "POST /v1/corrections": {
        const target = (typeof b.target === "object" && b.target ? b.target : {}) as Record<string, unknown>;
        return json(res, 201, await deps.rebuttals.publishCorrection({
          actorId: who.userId, target: { type: target.type as string, id: target.id as string }, description: b.description as string,
          outletId: b.outletId === undefined || b.outletId === "" ? undefined : (b.outletId as string),
        }));
      }
      case "POST /v1/verification/documents":
        return json(res, 201, await deps.verification.uploadDocument(who.userId, { ...pick(b, ["title", "issuer", "url", "text", "topics"]), publishedAt: date(b.publishedAt, "publishedAt") } as never));
      // ---- Datos reales y calidad ----
      case "POST /v1/catalog/import":
        return json(res, 200, await deps.catalog.import.execute({ actorId: who.userId, sourceId: str(b.sourceId, "sourceId") }));
      case "GET /v1/catalog/sources":
        return json(res, 200, { sources: await deps.catalog.import.sources(who.userId), csvUpload: !!deps.catalog.csvSource });
      case "POST /v1/catalog/import-csv": {
        const kind = str(b.kind, "kind");
        if (kind !== "outlets" && kind !== "ownership" && kind !== "advertising") throw new ValidationError("Tipo de CSV inválido.");
        const source = need(deps.catalog.csvSource)(kind, `CSV subido: ${kind}`, str(b.text, "text"));
        return json(res, 200, await deps.catalog.import.execute({ actorId: who.userId, sourceId: source.id, extraSources: [source] }));
      }
      case "GET /v1/quality": {
        const since = new Date(now().getTime() - 30 * 86_400_000);
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
        return json(res, 201, await P.campaigns.create({ ...(b as object), actorId: who.userId } as never));
      case "POST /v1/perspectives":
        return json(res, 201, await P.perspectives.publish({ ...(b as object), actorId: who.userId } as never));
      case "GET /v1/rooms":
        return json(res, 200, await P.rooms.list(who.userId));
      case "POST /v1/rooms":
        return json(res, 201, await P.rooms.create({ actorId: who.userId, name: str(b.name, "name"), topic: b.topic as string | undefined, slowModeSeconds: b.slowModeSeconds as number | undefined }));
      case "POST /v1/rebuttals":
        return json(res, 201, await deps.rebuttals.submit({ actorId: who.userId, outletId: str(b.outletId, "outletId"), target: b.target as never, statement: str(b.statement, "statement"), evidenceUrls: b.evidenceUrls as string[] | undefined }));
      case "POST /v1/analyze": {
        const text = str(b.text, "text");
        const at = now();
        let domain: string | undefined;
        if (b.url) {
          try {
            domain = new URL(String(b.url)).hostname;
          } catch {
            throw new ValidationError("El link no es válido.");
          }
        }
        const base = {
          id: randomUUID(), sourceType: b.url ? ("web" as const) : ("message" as const), origin: b.url ? { address: String(b.url), domain } : {},
          text, urls: text.match(/https?:\/\/[^\s)]+/g) ?? [], publishedAt: at, receivedAt: at, attachments: [], metadata: {},
        };
        // Un link a una red: se analiza lo que dice la publicación (igual que por el chat).
        const shared = deps.social ? await deps.social.readShared(text, { userId: who.userId }) : undefined;
        const item = shared?.post && deps.social ? deps.social.contentFor(shared.post, base) : base;
        const a = await deps.gateway.analyzeContent(who, item);
        return json(res, 200, { ...AccountQueries.view(a, shared?.post), ...(shared?.failed ? { postError: "No se pudo leer la publicación: se analizó el texto." } : {}) });
      }
      case "POST /v1/subscription/cancel":
        return json(res, 200, await need(deps.lifecycle).cancel({ actorId: who.userId }));
      case "POST /v1/subscription/resume":
        return json(res, 200, await need(deps.lifecycle).resume({ actorId: who.userId }));
      case "GET /v1/me":
        return json(res, 200, await need(deps.account).me(who.userId));
      case "GET /v1/me/analyses":
        return json(res, 200, await need(deps.account).history(who.userId, Number(url.searchParams.get("limit") ?? 30)));
      case "POST /v1/compare": {
        const r = await deps.gateway.compareSources(who, { topic: str(b.topic, "topic"), period: { from: date(b.from, "from"), to: date(b.to, "to") }, urlRules: b.urlRules as never });
        return json(res, 200, r);
      }
      case "POST /v1/credibility": {
        const r = await deps.gateway.evaluateCredibility(who, { outletId: str(b.outletId, "outletId"), topic: str(b.topic, "topic"), period: { from: date(b.from, "from"), to: date(b.to, "to") } });
        return json(res, 200, r);
      }
      case "GET /v1/organization":
        return json(res, 200, await need(deps.organizations).overview(who.userId));
      case "POST /v1/organization":
        return json(res, 201, await need(deps.organizations).create({ actorId: who.userId, name: str(b.name, "name") }));
      case "POST /v1/organization/invitations":
        return json(res, 201, await need(deps.organizations).invite({ actorId: who.userId, email: str(b.email, "email"), roleId: typeof b.roleId === "string" ? b.roleId : undefined }));
      case "POST /v1/organization/join":
        return json(res, 200, await need(deps.organizations).accept({ actorId: who.userId, token: str(b.token, "token") }));
      case "POST /v1/organization/leave":
        await need(deps.organizations).leave(who.userId);
        return json(res, 200, { ok: true });
      case "GET /v1/alerts":
        return json(res, 200, await need(deps.alerts).settings.list(who.userId));
      case "POST /v1/alerts": {
        const r = await need(deps.alerts).create.execute({
          actorId: who.userId, topic: str(b.topic, "topic").trim().slice(0, 120), trigger: str(b.trigger, "trigger") as never,
          channel: str(b.channel, "channel") as never, outletId: typeof b.outletId === "string" && b.outletId ? b.outletId : undefined,
        });
        return json(res, 201, (await need(deps.alerts).settings.list(who.userId)).find((a) => a.id === r.id));
      }
      case "POST /v1/origin":
        return json(res, 200, originView(await deps.gateway.traceOriginByUrl(who, { url: str(b.url, "url"), topic: typeof b.topic === "string" ? b.topic : undefined })));
      case "POST /v1/credibility/timeline": {
        const points = await deps.gateway.credibilityTimeline(
          who,
          { outletId: str(b.outletId, "outletId"), topic: str(b.topic, "topic"), period: { from: date(b.from, "from"), to: date(b.to, "to") } },
          Number(b.windows ?? 6),
        );
        return json(res, 200, points);
      }
      case "GET /v1/plan": {
        const user = await deps.access.userOrThrow(who.userId);
        const { plan } = await deps.access.planOf(user);
        return json(res, 200, { plan, usage: await deps.access.usageOf(user) });
      }
      case "POST /v1/reviews":
        return json(res, 201, await deps.reviews.submit({ userId: who.userId, target: b.target as never, rating: (b.rating as number | null) ?? null, text: b.text as string | undefined }));
      case "GET /v1/reviews/mine":
        return json(res, 200, (await deps.reviews.mine(who.userId, { type: str(url.searchParams.get("type"), "type") as never, id: str(url.searchParams.get("id"), "id") })) ?? null);
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

/** La traza sin el cuerpo de cada nota (la web sólo muestra título, medio, fecha y link). */
function originView(t: OriginTrace) {
  const art = (a: Article) => ({ id: a.id, title: a.title, url: a.url, outletId: a.outletId, publishedAt: a.publishedAt });
  return {
    target: art(t.target),
    origin: art(t.origin),
    chain: t.chain.map((l) => ({ article: art(l.article), similarityToOrigin: l.similarityToOrigin, isNearCopy: l.isNearCopy })),
    independentSources: t.independentSources,
    likelyPressRelease: t.likelyPressRelease,
    echoWarning: t.echoWarning,
  };
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

/**
 * ¿Es una ruta de ESTE sitio? "/cuenta" sí; "//atacante.com" o "/\atacante.com" no
 * (el navegador las toma como otro dominio: sería una redirección abierta).
 */
export function localPath(p: string): boolean {
  return /^\/(?![/\\])/.test(p) && !/[\u0000-\u001f]/.test(p);
}

/**
 * Secreto de un webhook. Sin configurar, el webhook no existe: comparar contra "" dejaría
 * pasar a cualquiera (y una firma HMAC con clave vacía la puede calcular cualquiera).
 */
function configured(secret: string, what: string): string {
  if (!secret.trim()) throw new HttpError(404, `${what} no está configurado.`);
  return secret;
}

/**
 * Campos permitidos de un cuerpo. Regla de todas las rutas: los datos de confianza (quién actúa,
 * sobre qué id) van DESPUÉS del cuerpo, así un "actorId" en el JSON nunca pisa a quien llama.
 */
function pick(b: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
}

function need<T>(x: T | undefined): T {
  if (!x) throw new HttpError(404, "Función no disponible.");
  return x;
}

function toHttpError(err: unknown): [number, Record<string, unknown>] {
  if (err instanceof HttpError) return [err.status, { error: err.message }];
  if (err instanceof AccessDeniedError) return [err.code === "quota_exceeded" || err.code === "too_many_attempts" ? 429 : 403, { error: err.message, code: err.code, upgradeHint: err.upgradeHint }];
  if (err instanceof ValidationError) return [400, { error: err.message }];
  if (err instanceof NotFoundError) return [404, { error: err.message }];
  if (err instanceof ConflictError) return [409, { error: err.message }];
  // Faltan datos para responder (p. ej. un medio sin notas en ese período): no es un error del servidor.
  if (err instanceof InsufficientDataError) return [422, { error: err.message, code: "insufficient_data" }];
  return [500, { error: "Error interno." }];
}

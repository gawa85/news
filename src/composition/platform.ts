/**
 * RAÍZ DE COMPOSICIÓN DE LA PLATAFORMA.
 * Único lugar que conoce clases concretas. Todo lo demás depende de interfaces.
 *
 *   ¿Otra base de datos?      → otro IDataStore en `store`
 *   ¿Otro proveedor de mail?  → otro IEmailTransport en `mail.transport`
 *   ¿Otro canal?              → su parser + renderer + sender en `channels`
 *   ¿Otro foro o sitio?       → otro IReplyPublisher / IImpactCollector
 *   ¿Otra fuente de reseñas?  → otro IReviewSource
 */
import { AccessControl, BusinessRuleEngine, UpgradeAdvisor } from "../application/access/AccessControl";
import { ProductGateway } from "../application/access/ProductGateway";
import { ComplianceGuard } from "../application/compliance/ComplianceGuard";
import { AnalyzeContentUseCase } from "../application/content/AnalyzeContentUseCase";
import { ConnectSourceUseCase, ReceiveEmailUseCase, SyncSourcesUseCase } from "../application/content/SourceUseCases";
import { CollectImpactUseCase, ImpactReportUseCase } from "../application/impact/ImpactUseCases";
import { ApiKeyService, WebhookService } from "../application/integrations/IntegrationServices";
import { ChannelRegistry } from "../application/messaging/ChannelRegistry";
import { HandleInboundMessageUseCase } from "../application/messaging/HandleInboundMessageUseCase";
import { NotificationService } from "../application/messaging/NotificationService";
import { ResponseComposer } from "../application/messaging/ResponseComposer";
import { ReplyService, TrackedLinkService } from "../application/replies/ReplyService";
import { ReviewService } from "../application/reviews/ReviewService";
import { UserRulesResolver } from "../application/rules/UserRulesResolver";
import { ManageRolesUseCase } from "../application/users/ManageRolesUseCase";
import { CredibilityChangeEvaluator, EvaluateAlertsUseCase, NewCoverageEvaluator, NewDisagreementEvaluator } from "../application/alerts/Alerts";
import { AuditQueryUseCase, AuditRecorder, DomainEventPublisher } from "../application/audit/Audit";
import { AuthService } from "../application/auth/AuthService";
import { ExportService } from "../application/exports/ExportService";
import { AssignOutletRepresentativeUseCase, RebuttalService } from "../application/rebuttals/Rebuttals";
import { CsvExporter, JsonExporter, PdfExporter, XlsxExporter } from "../infrastructure/exports/Exporters";
import { GoogleOAuthProvider, ScryptPasswordHasher } from "../infrastructure/security/AuthAdapters";
import { ChangePlanUseCase, ConfirmPaymentUseCase, CreateOrganizationUseCase } from "../application/users/PlansUseCases";
import { RegisterUserUseCase } from "../application/users/RegisterUserUseCase";
import { CreateAlertUseCase, LinkChannelUseCase, SaveRuleSetUseCase } from "../application/users/UserSettingsUseCases";
import { DEFAULT_POLICY, PLANS, PLATFORM_POLICIES, ROLES } from "../config/catalog";
import { defaultAccessRules } from "../domain/rules/accessRules";
import type { IBusinessRule, IDataStore, IEmailTransport, IHttpClient, IMessageSender, IOAuthProvider, IPasswordHasher, IPaymentGateway, IReviewSource } from "../domain/ports";
import { FakePaymentGateway } from "../infrastructure/billing/Payments";
import { CompliantMessageSender, CompliantReplyPublisher } from "../infrastructure/compliance/CompliantDecorators";
import { StaticPolicyRegistry } from "../infrastructure/compliance/StaticPolicyRegistry";
import { RssFeedSource } from "../infrastructure/content/RssSource";
import { EmailAuthenticationSignals, ForwardSignals, KnownOutletOriginSignal, LinkSignals } from "../infrastructure/content/signals";
import { DeliveryStatusCollector, DiscourseImpactCollector, WordPressImpactCollector } from "../infrastructure/impact/Collectors";
import { WebhookDispatcher } from "../infrastructure/integrations/WebhookDispatcher";
import { HtmlTextExtractor, ImapMailboxSource, PlainTextExtractor } from "../infrastructure/mail/MailAdapters";
import { MailparserMimeParser } from "../infrastructure/mail/MailparserMimeParser";
import { EmailChannelSender, TelegramUpdateParser, WhatsAppWebhookParser } from "../infrastructure/messaging/ChannelAdapters";
import { EmailRenderer, PlainTextRenderer, TelegramRenderer, WhatsAppRenderer } from "../infrastructure/messaging/Renderers";
import { SpanishCommandParser } from "../infrastructure/messaging/SpanishCommandParser";
import {
  ChannelReplyPublisher,
  DiscourseReplyPublisher,
  SiteWebhookPublisher,
  WordPressCommentPublisher,
  type DiscourseSite,
  type OwnSite,
  type WordPressSite,
} from "../infrastructure/replies/Publishers";
import { AppStoreReviewSource, GooglePlayReviewSource, RuleBasedReviewModerator } from "../infrastructure/reviews/ReviewAdapters";
import { EncryptedSecretVault, HashedVerificationCodeService, RoleBasedAuthorization } from "../infrastructure/security/Security";
import { InMemoryEventBus } from "../infrastructure/system/EventsAndHttp";
import { buildApp, type AppConfig } from "./container";
import type { HttpApiDeps } from "../infrastructure/http/HttpApi";
import { InvoicingService, SetBillingProfileUseCase, type SellerConfig } from "../application/billing/Invoicing";
import { CostReportUseCase, CostTracker } from "../application/costs/Costs";
import { VerificationDesk, VerificationTaskGenerator } from "../application/factcheck/VerificationDesk";
import { JobWorker, PersistentJobQueue, RecurringScheduler } from "../application/jobs/Jobs";
import { PersonalDataService, RetentionUseCase } from "../application/privacy/PersonalData";
import { COST_POLICY, PRICE_TABLE, SCHEDULES } from "../config/catalog";
import type { IInvoiceIssuer, IMetrics, IPrimarySourceProvider } from "../domain/ports";
import { FakeInvoiceIssuer } from "../infrastructure/billing/Payments";
import { DatosGobArSeriesProvider, DocumentLibraryProvider, type SeriesMapping } from "../infrastructure/factcheck/PrimarySources";
import { AsyncRequestContext, CachedSmokeDetector, CostRecordingSender, MemoryTtlCache, MeteredLLMClient, PrometheusMetrics } from "../infrastructure/observability/Observability";
import { SystemClock } from "../infrastructure/system/System";
import { CampaignService, type ElectoralBlackout } from "../application/participation/Campaigns";
import { NarrativeTracker } from "../application/participation/Narratives";
import { PerspectiveService } from "../application/participation/Perspectives";
import { RoomService } from "../application/participation/Rooms";
import { InMemoryRealtimeHub, SvgCardGenerator, TopicFollowersChannel } from "../infrastructure/participation/Participation";
import { ImportCatalogUseCase, IngestFeedsUseCase } from "../application/catalog/CatalogUseCases";
import { FeedbackService, QualityService } from "../application/quality/Quality";
import { HttpFeedReader } from "../infrastructure/catalog/CatalogAdapters";
import { SEED_CATEGORIES, SEED_TOPICS } from "../config/topics";
import { PARAMETERS } from "../config/parameters";
import { seedTaxonomy, TaxonomyService } from "../application/config/Taxonomy";
import { TopicIndex } from "../application/config/TopicIndex";
import { PreferencesService } from "../application/config/Preferences";
import { BusinessRulesService, CachedRuleSource, ParameterService } from "../application/config/BusinessRules";
import { DEFERRED_NOTIFICATION_JOB } from "../application/messaging/NotificationService";
import { SEED_EVALUATION_SET } from "../config/evaluationSet";
import type { IBackupSink, IDnsTxtResolver, IFeedReader, IOutletCatalogSource, IPlainLanguageRewriter, IProductAnalytics, ISupportDesk, ITextToSpeech } from "../domain/ports";
import type { ResponseContent, User } from "../domain/model";
import { BrandingService, CommerceService, CountryRegistry, ReferralService } from "../application/commerce/Commerce";
import { LearningService, seedQuizItems } from "../application/learning/Learning";
import { SupportService } from "../application/support/Support";
import { FeatureFlagService } from "../application/flags/FeatureFlags";
import { AudioReplyService } from "../application/inclusion/AudioReplies";
import { VoiceNoteService } from "../application/inclusion/VoiceNotes";
import { ScreenshotService } from "../application/inclusion/Screenshots";
import { EvidenceService, type EvidenceProviders } from "../application/evidence/Evidence";
import { DigestAudience, DigestService } from "../application/digest/Digests";
import {
  CirculatingNarrativesDigestSource,
  CorrectionsDigestSource,
  FollowedTopicsDigestSource,
  WatchedNotesDigestSource,
} from "../application/digest/DigestSources";
import { HttpPageCapturer } from "../infrastructure/evidence/HttpPageCapturer";
import { DatabaseEvidenceBlobStore } from "../infrastructure/evidence/EvidenceStores";
import type { IDigestSource, IInboundMediaFetcher, IOcr, ISpeechToText } from "../domain/ports";
import { NodeDnsTxtResolver, RuleBasedPlainLanguage, SignedMediaStore } from "../infrastructure/inclusion/InclusionAdapters";
import { COUNTRIES, DEFAULT_COUNTRY } from "../config/countries";
import { FEATURE_FLAGS } from "../config/flags";
import { CLEAN_TIP, SMOKE_TIPS } from "../config/learning";
import { DefamationAwareModerator, LegalService } from "../application/legal/Legal";
import { LEGAL_DOCUMENTS } from "../config/legal";
import { BackupService } from "../application/ops/Backups";
import { SandboxGuardSender } from "../infrastructure/messaging/SandboxGuard";
import { StatsRecorder, StatsService } from "../application/stats/Stats";
import { BiFeedService, NarrativesDataset, OfficialAdvertisingDataset, OpenDataService, SmokeByTypeDataset } from "../application/stats/OpenData";
import { ScheduledReportService } from "../application/exports/ScheduledReports";
import { KAnonymizer, NoopProductAnalytics } from "../infrastructure/stats/StatsAdapters";
import { OverlapSimilarity } from "../infrastructure/heuristics/JaccardSimilarity";
import type { ICampaignChannel, IRealtimeTransport } from "../domain/ports";

export interface PlatformConfig {
  store: IDataStore;
  core: Omit<AppConfig, "store">;
  publicBaseUrl: string;
  vaultMasterKey: string;
  http: IHttpClient;
  /** Senders "crudos" de cada canal (WhatsApp, Telegram, SMS). Se envuelven con cumplimiento. */
  senders: IMessageSender[];
  mail: { transport: IEmailTransport; from: string; trustedAuthServIds: string[] };
  forums?: { discourse?: DiscourseSite[]; wordpress?: WordPressSite[]; sites?: OwnSite[] };
  payments?: IPaymentGateway;
  reviewSources?: IReviewSource[];
  /** Reglas de negocio extra (se agregan a las de siempre). */
  extraRules?: IBusinessRule[];
  /** Cómo esperar (tests: adelantar un reloj manual en vez de dormir). */
  wait?: (ms: number) => Promise<void>;
  /** Login con proveedores externos. */
  oauth?: { google?: { clientId: string; clientSecret: string } };
  /** Hash de contraseñas (tests: uno más liviano). */
  passwordHasher?: IPasswordHasher;
  /** Facturación: quién emite (condición fiscal, punto de venta) y con qué servicio (ARCA). */
  invoicing?: { seller: SellerConfig; issuer: IInvoiceIssuer };
  /** Series estadísticas oficiales para verificar (palabras clave → serie de datos.gob.ar). */
  statisticsCatalog?: SeriesMapping[];
  /** Otras fuentes primarias. */
  primarySources?: IPrimarySourceProvider[];
  metrics?: IMetrics;
  /** Canales propios de difusión extra (canal de Telegram, sitio de la organización…). */
  campaignChannels?: ICampaignChannel[];
  /** Vedas electorales: no se difunden campañas políticas en esas fechas. */
  electoralBlackouts?: ElectoralBlackout[];
  realtime?: IRealtimeTransport;
  /** Fuentes del catálogo (CSV propios, datasets abiertos de pauta, registros de propiedad). */
  catalogSources?: IOutletCatalogSource[];
  /** Lector de feeds RSS/Atom (por defecto, HTTP). */
  feedReader?: IFeedReader;
  /** Estadísticas públicas: clave del seudonimizador y tamaño mínimo de grupo (k-anonimato). */
  stats?: { pseudonymSecret?: string; minGroupSize?: number; rounding?: number };
  /** Analítica de producto externa (PostHog, Mixpanel…). Por defecto, ninguna. */
  productAnalytics?: IProductAnalytics;
  /** Consultas DNS (verificación de dominios de marca blanca). */
  dns?: IDnsTxtResolver;
  /** Texto a voz (sin esto, no hay respuestas en audio). */
  tts?: ITextToSpeech;
  /** Descarga de archivos recibidos por cada canal (audios, capturas). */
  mediaFetchers?: IInboundMediaFetcher[];
  /** Audio a texto (sin esto, no se entienden las notas de voz). */
  speech?: ISpeechToText;
  /** Lectura de capturas (sin esto, no se leen imágenes). */
  ocr?: IOcr;
  /**
   * Archivo de evidencias. Por defecto: descarga HTTP con protección SSRF y copias en la base,
   * sin sello de tiempo ni copia pública (se activan pasando sus adaptadores).
   */
  evidence?: Partial<EvidenceProviders>;
  /** Partes extra del resumen (se agregan al final de las de siempre). */
  digestSources?: IDigestSource[];
  /** Lectura fácil (por defecto, reglas; con IA: LLMPlainLanguageRewriter). */
  plainLanguage?: IPlainLanguageRewriter;
  /** Mesa de ayuda externa opcional (Zendesk…). */
  supportDesk?: ISupportDesk;
  /** Ambiente: fuera de producción, sólo se envía a la lista del equipo y con prefijo. */
  environment?: { name: string; sandbox?: { allowlist: string[]; prefix: string } };
  /** Copias de seguridad (sin esto, los trabajos de copia avisan que no están configuradas). */
  backups?: { sink: IBackupSink; passphrase: string; scratch: () => IDataStore };
}

export function buildPlatform(cfg: PlatformConfig) {
  const { repos } = cfg.store;

  // ---- Observabilidad y costos (se arman antes para envolver el núcleo) ----
  const clock = cfg.core.clock ?? new SystemClock();
  const metrics = cfg.metrics ?? new PrometheusMetrics();
  const requestContext = new AsyncRequestContext();
  const costs = new CostTracker(repos.costs, PRICE_TABLE, requestContext, clock, metrics);
  const cache = new MemoryTtlCache(clock);

  const core = buildApp({
    ...cfg.core,
    clock,
    store: cfg.store,
    decorate: {
      llm: (c) => new MeteredLLMClient(c, costs),
      smokeDetector: (d) => new CachedSmokeDetector(d, cache, metrics),
    },
    promptSafety: {
      ...cfg.core.promptSafety,
      onDetected: (a, where) => {
        metrics.increment("sinhumo_prompt_injection_total", { risk: a.risk, where });
        cfg.core.promptSafety?.onDetected?.(a, where);
      },
    },
  });
  const { ids, logger } = core;
  const forums = { discourse: [], wordpress: [], sites: [], ...cfg.forums };

  // ---- Seguridad ----
  const authz = new RoleBasedAuthorization(repos.roles);
  const vault = new EncryptedSecretVault(repos.secrets, cfg.vaultMasterKey, clock);
  const codes = new HashedVerificationCodeService(repos.verificationCodes, clock);
  const events = new InMemoryEventBus(logger);
  const domainEvents = new DomainEventPublisher(events, ids, clock);
  new AuditRecorder(repos.audit).attach(events);

  // ---- Configuración del negocio: temas, parámetros y reglas configurables ----
  const topicIndex = new TopicIndex(repos.taxonomy, clock);
  const params = new ParameterService(PARAMETERS, repos.businessRules, repos.users, authz, domainEvents, clock);
  const ruleSource = new CachedRuleSource(repos.businessRules, clock);
  const taxonomy = new TaxonomyService(repos.taxonomy, repos.users, authz, domainEvents, clock);
  const preferences = new PreferencesService(repos.preferences, repos.taxonomy, topicIndex, repos.users, authz, domainEvents, clock);
  const businessRules = new BusinessRulesService(repos.businessRules, repos.users, authz, domainEvents, clock, () => ruleSource.invalidate());
  events.subscribe(async (e) => {
    if (e.type === "taxonomy.changed") topicIndex.invalidate();
  });
  const queue = new PersistentJobQueue(repos.jobs, clock);

  // ---- Acceso: roles + planes + cuotas + reglas (fijas en código + configurables) ----
  const access = new AccessControl(
    repos.users, authz, repos.subscriptions, repos.plans, repos.usage,
    new BusinessRuleEngine([...defaultAccessRules(), ...(cfg.extraRules ?? [])]),
    new UpgradeAdvisor(repos.plans), clock, { utcOffsetMinutes: -180 }, ruleSource,
  );
  const userRules = new UserRulesResolver(repos.ruleSets);

  // ---- Contenido (mails, mensajes, RSS...) ----
  const mimeParser = new MailparserMimeParser({ trustedAuthServIds: cfg.mail.trustedAuthServIds, maxAttachmentBytes: 5_000_000 }, [new PlainTextExtractor(), new HtmlTextExtractor()]);
  const analyzeContent = new AnalyzeContentUseCase(
    core.smokeDetector,
    [new EmailAuthenticationSignals(), new ForwardSignals(), new LinkSignals(repos.outlets), new KnownOutletOriginSignal(repos.outlets)],
    repos.outlets, repos.contentAnalyses, ids, clock,
  );
  const rebuttals = new RebuttalService(repos.rebuttals, repos.corrections, repos.verdicts, repos.users, repos.outlets, authz, domainEvents, ids, clock);
  const gateway = new ProductGateway(access, userRules, { ...core, analyzeContent }, events, clock, (outletId) => rebuttals.publicRecord(outletId), { metrics, context: requestContext }, topicIndex);

  // ---- Cumplimiento ("anti bloqueo" legítimo) ----
  const guard = new ComplianceGuard(
    new StaticPolicyRegistry(PLATFORM_POLICIES, DEFAULT_POLICY),
    repos.deliveryLog, repos.destinationHealth, repos.optOuts, repos.conversationWindows, clock,
  );

  // ---- Canales ----
  const guarded = (s: IMessageSender): IMessageSender =>
    cfg.environment?.sandbox ? new SandboxGuardSender(s, cfg.environment.sandbox.allowlist, cfg.environment.sandbox.prefix, logger) : s;
  const compliant = (s: IMessageSender) =>
    new CompliantMessageSender(new CostRecordingSender(guarded(s), costs), guard, { unsubscribeUrl: `${cfg.publicBaseUrl}/baja`, ...(cfg.wait ? { wait: cfg.wait } : {}) }, () => clock.now());
  const channels = new ChannelRegistry({
    parsers: [new WhatsAppWebhookParser(), new TelegramUpdateParser()],
    renderers: [new WhatsAppRenderer(), new TelegramRenderer(), new EmailRenderer(), new PlainTextRenderer("sms", 1600), new PlainTextRenderer("web", 20_000)],
    senders: [...cfg.senders.map(compliant), compliant(new EmailChannelSender(cfg.mail.transport, cfg.mail.from))],
  });
  const branding = new BrandingService(repos.branding, repos.users, authz, access, cfg.dns ?? new NodeDnsTxtResolver(), domainEvents, clock, [new URL(cfg.publicBaseUrl).hostname]);
  const notifications = new NotificationService(channels, { reader: preferences, queue, clock, brand: (u) => branding.markFor(u) });
  /** Aviso simple a una persona por su canal preferido (fuera de la ventana de WhatsApp, con plantilla). */
  const tell = (template: string) => async (u: User, title: string, summary: string) => {
    const { plan } = await access.planOf(u);
    const content: ResponseContent = { kind: "info", title, summary, sections: [], links: [] };
    return notifications.notifyUser(u, content, plan.channels, { name: template, language: "es_AR", params: [title, summary.slice(0, 200)] });
  };
  const composer = new ResponseComposer(repos.outlets);

  // ---- Usuarios, roles, planes ----
  // ---- Comercial: países, precios, cupones ----
  const countries = new CountryRegistry(COUNTRIES, DEFAULT_COUNTRY);
  const commerce = new CommerceService(repos.coupons, repos.plans, repos.subscriptions, repos.users, repos.organizations, countries, authz, domainEvents, clock);
  commerce.attach(events);
  const register = new RegisterUserUseCase(cfg.store, ids, clock, { roleIds: ["reader"], planId: "gratis", trialDays: 0 }, domainEvents);
  const payments = cfg.payments ?? new FakePaymentGateway();
  const changePlan = new ChangePlanUseCase(repos.users, repos.plans, authz, payments, cfg.store, ids, clock, domainEvents, commerce);
  const saveRules = new SaveRuleSetUseCase(repos.ruleSets, authz, access, ids, clock, domainEvents);

  // ---- Respuestas en cualquier destino ----
  const trackedLinks = new TrackedLinkService(repos.trackedLinks, cfg.publicBaseUrl, clock);
  const publishers = [
    new ChannelReplyPublisher(notifications), // mail y chats: ya pasan por los senders con cumplimiento
    ...[
      new DiscourseReplyPublisher(cfg.http, forums.discourse),
      new WordPressCommentPublisher(cfg.http, forums.wordpress),
      new SiteWebhookPublisher(cfg.http, forums.sites),
    ].map((p) => new CompliantReplyPublisher(p, guard)),
  ];
  const replies = new ReplyService(publishers, repos.replyDrafts, authz, access, trackedLinks, events, ids, clock);

  // ---- Impacto ----
  const deliveryStatus = new DeliveryStatusCollector();
  const collectImpact = new CollectImpactUseCase(
    repos.replyDrafts,
    [new DiscourseImpactCollector(cfg.http, forums.discourse), new WordPressImpactCollector(cfg.http, forums.wordpress), deliveryStatus],
    repos.impact, repos.trackedLinks, ids, clock, logger,
  );

  // ---- Reseñas ----
  const reviews = new ReviewService(
    repos.reviews, repos.users, repos.replyDrafts, new RuleBasedReviewModerator(),
    cfg.reviewSources ?? [new AppStoreReviewSource(cfg.http), new GooglePlayReviewSource(cfg.http)], clock,
  );

  // ---- Integraciones: API, webhooks, MCP ----
  const apiKeys = new ApiKeyService(repos.apiKeys, repos.users, authz, access, ids, clock, domainEvents);
  const webhooks = new WebhookService(repos.webhooks, vault, authz, access, ids, clock, domainEvents);

  // ---- Login web ----
  const oauthProviders: IOAuthProvider[] = cfg.oauth?.google ? [new GoogleOAuthProvider(cfg.http, cfg.oauth.google)] : [];
  const auth = new AuthService(
    repos.users, register, repos.sessions, repos.credentials, repos.magicLinks, repos.oauthStates, repos.loginAttempts,
    cfg.passwordHasher ?? new ScryptPasswordHasher(), oauthProviders, notifications, domainEvents, ids, clock,
    { publicBaseUrl: cfg.publicBaseUrl },
  );

  // ---- Alertas ----
  const evaluateAlerts = new EvaluateAlertsUseCase(
    repos.alerts,
    [new NewCoverageEvaluator(repos.articles, repos.outlets), new NewDisagreementEvaluator(core.compareSources), new CredibilityChangeEvaluator(core.evaluateCredibility)],
    repos.users, access, notifications, domainEvents, clock, logger, undefined, requestContext,
  );


  // ---- Verificación ----
  new VerificationTaskGenerator(repos.verificationTasks, domainEvents, clock, logger).attach(events);
  const verification = new VerificationDesk(
    repos.verificationTasks, repos.verdicts, repos.officialDocuments,
    [new DocumentLibraryProvider(repos.officialDocuments), new DatosGobArSeriesProvider(cfg.http, cfg.statisticsCatalog ?? []), ...(cfg.primarySources ?? [])],
    repos.users, authz, domainEvents, ids, clock, logger,
  );

  // ---- Facturación ----
  const invoicing = new InvoicingService(
    repos.invoices, repos.billingProfiles, repos.subscriptions, repos.plans,
    cfg.invoicing?.issuer ?? new FakeInvoiceIssuer(), domainEvents, clock,
    cfg.invoicing?.seller ?? { taxCondition: "responsable_inscripto", pointOfSale: 1, vatRate: 0.21 },
  );
  invoicing.attach(events, queue);

  // ---- Datos personales ----
  const personalData = new PersonalDataService(cfg.store, domainEvents, clock);
  const retention = new RetentionUseCase(repos, clock);

  // ---- Participación: narrativas, campañas, otra mirada, salas ----
  // Moderación + riesgo de difamación (nombres de medios y de sus dueños).
  const moderator = new DefamationAwareModerator(new RuleBasedReviewModerator(), async () => [
    ...(await repos.outlets.findAll()).flatMap((o) => [o.name, ...(o.aliases ?? [])]),
    ...(await repos.catalog.findOwners()).map((o) => o.name),
  ]);
  const narratives = new NarrativeTracker(repos.narratives, repos.contentAnalyses, new OverlapSimilarity(), ids, clock);
  narratives.attach(events);
  const campaigns = new CampaignService(
    repos.campaigns, repos.narratives,
    [new TopicFollowersChannel(repos.alerts, repos.users, access, notifications, undefined, preferences), ...(cfg.campaignChannels ?? [])],
    new SvgCardGenerator(), moderator, trackedLinks, repos.trackedLinks, notifications, repos.users, authz, access,
    domainEvents, ids, clock, repos.organizations, cfg.electoralBlackouts ?? [],
  );
  const perspectives = new PerspectiveService(repos.perspectives, repos.verificationTasks, repos.users, authz, moderator, domainEvents, clock);
  const realtime = cfg.realtime ?? new InMemoryRealtimeHub();
  const rooms = new RoomService(repos.rooms, realtime, repos.users, authz, access, moderator, ids, clock);

  // ---- Datos reales: catálogo importable y noticias desde los feeds ----
  const importCatalog = new ImportCatalogUseCase(cfg.catalogSources ?? [], repos.catalog, repos.outlets, repos.users, authz, domainEvents, countries);
  const ingestFeeds = new IngestFeedsUseCase(
    repos.catalog, repos.outlets, cfg.feedReader ?? new HttpFeedReader(cfg.http), topicIndex,
    repos.articles, core.extractor, repos.claims, clock, logger,
  );

  // ---- Calidad medible: set de evaluación, versiones y "¿te sirvió?" ----
  const qualityService = new QualityService(repos.quality, repos.users, authz, domainEvents, ids, clock, 0.02, params);
  const feedback = new FeedbackService(repos.quality, repos.contentAnalyses, clock, params);
  const quality = {
    service: qualityService,
    feedback,
    /** Evalúa la versión que está corriendo (la del detector configurado). */
    evaluateCurrent: (actorId: string) => qualityService.evaluate({ actorId, detector: core.smokeDetector }),
    currentVersion: () => core.smokeDetector.version ?? "sin-version",
  };

  // ---- Estadísticas ----
  const anonymizer = new KAnonymizer(cfg.stats?.pseudonymSecret ?? `${cfg.vaultMasterKey}:estadisticas`, cfg.stats?.minGroupSize ?? 10, cfg.stats?.rounding ?? 5);
  new StatsRecorder(repos.stats, anonymizer, cfg.productAnalytics ?? new NoopProductAnalytics(), logger, params, topicIndex).attach(events);
  const statsService = new StatsService(repos.stats, repos.users, repos.subscriptions, repos.plans, repos.narratives, authz, anonymizer);
  const openData = new OpenDataService([new SmokeByTypeDataset(statsService), new NarrativesDataset(statsService), new OfficialAdvertisingDataset(repos.catalog, repos.outlets)]);
  const biFeed = new BiFeedService(repos.contentAnalyses, repos.stats, repos.users, authz, access);

  // ---- 4D: referidos, funciones en prueba, inclusión y soporte ----
  const referrals = new ReferralService(repos.referrals, commerce, repos.users, repos.subscriptions, params, domainEvents, clock, tell("aviso_premio"));
  referrals.attach(events);
  const flags = new FeatureFlagService(FEATURE_FLAGS, repos.featureFlags, repos.users, authz, domainEvents, clock);
  const media = new SignedMediaStore(repos.media, `${cfg.vaultMasterKey}:media`, cfg.publicBaseUrl, clock);
  const ttsPrice = PRICE_TABLE.textToSpeechPerMillionCharsUsd ?? 0;
  const audio = cfg.tts ? new AudioReplyService(cfg.tts, media, 1500, 7 * 24 * 3600, (chars) => costs.units("text_to_speech", cfg.tts!.id, { characters: chars }, (chars / 1_000_000) * ttsPrice)) : undefined;
  const sttPrice = PRICE_TABLE.speechToTextPerMinuteUsd;
  const mediaFetchers = cfg.mediaFetchers ?? [];
  const voice = cfg.speech
    ? new VoiceNoteService(cfg.speech, mediaFetchers, () => params.number("voice.max_seconds"),
        (seconds) => costs.units("speech_to_text", cfg.speech!.id, { seconds }, (seconds / 60) * sttPrice))
    : undefined;
  const screenshots = cfg.ocr
    ? new ScreenshotService(cfg.ocr, mediaFetchers, {
        perImage: (provider) => costs.units("ocr", provider, { images: 1 }, PRICE_TABLE.ocrPerImageUsd),
        llm: (model, input, output) => costs.llm(model, input, output),
      })
    : undefined;
  const plainLanguage = cfg.plainLanguage ?? new RuleBasedPlainLanguage();
  const learning = new LearningService(repos.learning, repos.users, authz, access, domainEvents, ids, clock, { byType: SMOKE_TIPS, clean: CLEAN_TIP });
  const backups = cfg.backups
    ? new BackupService(cfg.store, cfg.backups.sink, cfg.backups.passphrase, cfg.backups.scratch, clock, logger, cfg.environment?.name ?? "development", domainEvents, { users: repos.users, authz })
    : undefined;
  const legal = new LegalService(LEGAL_DOCUMENTS, repos.consents, clock, cfg.publicBaseUrl);
  const support = new SupportService(repos.tickets, repos.users, authz, access, params, domainEvents, ids, clock, logger, tell("soporte_respuesta"), cfg.supportDesk);
  const evidence = new EvidenceService(
    repos.evidence,
    {
      capturer: cfg.evidence?.capturer ?? new HttpPageCapturer(),
      blobs: cfg.evidence?.blobs ?? new DatabaseEvidenceBlobStore(repos.evidenceBlobs),
      timestamp: cfg.evidence?.timestamp,
      archives: cfg.evidence?.archives,
    },
    authz, access, params, domainEvents, queue, ids, clock, logger,
  );
  // Resumen: cada parte es una fuente; el orden de la lista es el orden del mensaje.
  const digests = new DigestService(
    [
      new WatchedNotesDigestSource(repos.evidence),
      new FollowedTopicsDigestSource(repos.articles, repos.outlets, repos.taxonomy),
      new CirculatingNarrativesDigestSource(repos.narratives, repos.taxonomy),
      new CorrectionsDigestSource(repos.corrections, repos.outlets),
      ...(cfg.digestSources ?? []),
    ],
    repos.digests, new DigestAudience(repos.preferences, repos.users), preferences, access, countries, notifications, composer, params, flags, clock, logger,
  );

  // ---- Auditoría y exportación ----
  const auditQuery = new AuditQueryUseCase(repos.audit, repos.users, authz);
  const impactReport = new ImpactReportUseCase(repos.replyDrafts, repos.impact);
  const exports = new ExportService(
    [new CsvExporter(), new JsonExporter(), new PdfExporter(), new XlsxExporter()],
    gateway, access, authz, repos.contentAnalyses, impactReport, auditQuery, repos.outlets, domainEvents, clock, statsService,
  );
  const scheduledReports = new ScheduledReportService(repos.reportSchedules, exports, access, repos.users, notifications, domainEvents, ids, clock, logger, params);
  new WebhookDispatcher(repos.webhooks, vault, cfg.http, logger).attach(events);

  // ---- Fuentes conectadas ----
  const contentSources = [new ImapMailboxSource(mimeParser), new RssFeedSource(cfg.http)];
  const syncSources = new SyncSourcesUseCase(contentSources, repos.sourceConnections, vault, gateway, clock, logger);

  return {
    core,
    store: cfg.store,
    publicBaseUrl: cfg.publicBaseUrl,
    gateway,
    access,
    authz,
    events,
    domainEvents,
    guard,
    channels,
    notifications,
    composer,
    vault,
    mimeParser,
    deliveryStatus,
    trackedLinks,
    users: {
      register,
      roles: new ManageRolesUseCase(repos.users, repos.roles, authz, domainEvents),
      createOrganization: new CreateOrganizationUseCase(cfg.store, ids, clock, { adminRoleId: "org_admin", defaultPlanId: "equipo" }, domainEvents),
      changePlan,
      confirmPayment: new ConfirmPaymentUseCase(cfg.store, domainEvents, clock),
      assignOutletRepresentative: new AssignOutletRepresentativeUseCase(repos.users, repos.outlets, authz, domainEvents),
      linkChannel: new LinkChannelUseCase(repos.users, codes, notifications, cfg.store, clock),
      saveRules,
      createAlert: new CreateAlertUseCase(repos.alerts, authz, access, ids, clock),
    },
    inbound: new HandleInboundMessageUseCase(
      repos.users, register, new SpanishCommandParser(), gateway, access, saveRules, repos.ruleSets, repos.outlets,
      composer, notifications, repos.conversationWindows, repos.optOuts, requestContext, { feedback, preferences, taxonomy, params, learning, support, referrals, branding, audio, plainLanguage, flags, legal, voice, screenshots, evidence, digests },
    ),
    content: {
      connect: new ConnectSourceUseCase(contentSources, repos.sourceConnections, vault, authz, access, ids, clock),
      sync: syncSources,
      receiveEmail: new ReceiveEmailUseCase(mimeParser, repos.users, register, gateway, composer, replies, logger),
    },
    replies,
    impact: { collect: collectImpact, report: impactReport },
    reviews,
    integrations: { apiKeys, webhooks },
    auth,
    alerts: { evaluate: evaluateAlerts },
    jobs: {
      queue,
      scheduler: new RecurringScheduler(queue, SCHEDULES, clock),
      /** Un worker con los manejadores de cada tipo de trabajo. */
      worker: (opts: { workerId?: string } = {}) =>
        new JobWorker(repos.jobs, {
          sync_sources: async () => void (await syncSources.execute()),
          evaluate_alerts: async () => void (await evaluateAlerts.execute()),
          ingest_feeds: async () => void (await ingestFeeds.execute()),
          send_reports: async () => void (await scheduledReports.runDue()),
          support_sla: async () => void (await support.checkSla()),
          backup_daily: async () => {
            if (!backups) return logger.warn("Copias de seguridad sin configurar: no se hizo la copia diaria.");
            await backups.runDaily();
          },
          backup_verify: async () => {
            if (!backups) return;
            const r = await backups.verifyLatest();
            if (r && !r.verification?.ok) throw new Error(`La última copia no se pudo restaurar: ${r.verification?.detail}`);
          },
          media_cleanup: async () => void (await repos.media.deleteExpired(clock.now())),
          evidence_seal: async (p) => void (await evidence.seal(String(p.id))),
          evidence_recheck: async () => void (await evidence.recheckDue()),
          send_digests: async () => void (await digests.runDue()),
          [DEFERRED_NOTIFICATION_JOB]: async (p) => {
            const u = await repos.users.findById(String(p.userId));
            if (!u || u.status !== "active") return;
            await notifications.notifyUser(u, p.content as never, p.allowed as never, p.whatsappTemplate as never, { ignoreQuietHours: true });
          },
          collect_impact: async () => void (await collectImpact.execute({ lookbackDays: 30 })),
          retention: async () => void (await retention.execute()),
          issue_invoice: async (p) => void (await invoicing.issueForSubscription(String(p.subscriptionId))),
        }, clock, logger, opts),
    },
    verification,
    billing: { setProfile: new SetBillingProfileUseCase(repos.billingProfiles, repos.users, authz, clock, countries), invoicing },
    privacy: { personalData, retention },
    costs: { tracker: costs, report: new CostReportUseCase(repos.costs, repos.subscriptions, repos.plans, repos.users, authz, COST_POLICY) },
    metrics,
    requestContext,
    participation: { narratives, campaigns, perspectives, rooms },
    catalog: { import: importCatalog, ingestFeeds },
    stats: { service: statsService, openData, biFeed, scheduledReports, anonymizer },
    config: { taxonomy, topics: topicIndex, preferences, businessRules, params },
    commerce: { service: commerce, referrals, branding, countries },
    inclusion: { learning, audio, plainLanguage, media, voice, screenshots },
    flags,
    support,
    evidence,
    digests,
    legal,
    backups,
    environment: cfg.environment?.name ?? "development",
    quality,
    audit: auditQuery,
    rebuttals,
    exports,
  };
}

export type Platform = ReturnType<typeof buildPlatform>;

/** Dependencias de la API HTTP a partir de la plataforma (un solo lugar para armarlas). */
export function httpApiDeps(p: Platform, opts: { secrets: HttpApiDeps["secrets"]; maxBodyBytes?: number; metricsToken?: string }): HttpApiDeps {
  return {
    gateway: p.gateway, access: p.access, authz: p.authz, apiKeys: p.integrations.apiKeys, composer: p.composer,
    replies: p.replies, reviews: p.reviews, impactReport: p.impact.report, trackedLinks: p.trackedLinks,
    inbound: p.inbound, confirmPayment: p.users.confirmPayment, deliveryStatus: p.deliveryStatus, outlets: p.store.repos.outlets,
    parsers: { whatsapp: p.channels.parser("whatsapp"), telegram: p.channels.parser("telegram") },
    logger: p.core.logger, auth: p.auth, exports: p.exports, audit: p.audit, rebuttals: p.rebuttals,
    publicBaseUrl: p.publicBaseUrl, secrets: opts.secrets, maxBodyBytes: opts.maxBodyBytes,
    verification: p.verification, personalData: p.privacy.personalData, billingProfile: p.billing.setProfile,
    invoices: p.store.repos.invoices, costReport: p.costs.report, participation: p.participation,
    catalog: p.catalog, quality: p.quality, stats: p.stats, config: p.config,
    commerce: p.commerce, inclusion: p.inclusion, flags: p.flags, support: p.support, evidence: p.evidence, changePlan: p.users.changePlan, legal: p.legal, backups: p.backups, environment: p.environment,
    metrics: p.metrics instanceof PrometheusMetrics ? { render: () => (p.metrics as PrometheusMetrics).render(), token: opts.metricsToken ?? "" } : undefined,
  };
}

/** Carga roles y planes del catálogo (idempotente). */
export async function seedPlatform(store: IDataStore): Promise<void> {
  for (const r of ROLES) await store.repos.roles.save(r);
  for (const p of PLANS) await store.repos.plans.save(p);
  await seedTaxonomy(store.repos.taxonomy, { categories: SEED_CATEGORIES, topics: SEED_TOPICS }, new Date());
  await seedQuizItems(store.repos.learning, SEED_EVALUATION_SET, (isSmoke, types) =>
    isSmoke ? types.map((t) => SMOKE_TIPS[t]).join(" ") : CLEAN_TIP);
  // Set de evaluación semilla (ids fijos: idempotente; no pisa ejemplos que el equipo haya corregido).
  const existing = new Set((await store.repos.quality.findExamples()).map((e) => e.id));
  for (const [i, e] of SEED_EVALUATION_SET.entries()) {
    const id = `seed_${String(i + 1).padStart(3, "0")}`;
    if (existing.has(id)) continue;
    await store.repos.quality.saveExample({
      id, text: e.text, expected: { isSmoke: e.isSmoke, types: e.types }, source: "curated", reviewed: true,
      addedBy: "sistema", addedAt: new Date("2026-01-01T00:00:00Z"),
    });
  }
}

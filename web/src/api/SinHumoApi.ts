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
} from "./types";

/**
 * Lo que la web necesita del servidor (puerto). Las pantallas dependen de esta interfaz,
 * nunca de fetch: en las pruebas se usa una implementación falsa (DIP).
 */
export interface SinHumoApi {
  // Acceso
  authOptions(): Promise<AuthOptions>;
  /** `next`: adónde vuelve el enlace del mail (una ruta de la web). */
  requestMagicLink(email: string, captchaToken?: string, next?: string): Promise<void>;
  loginWithPassword(email: string, password: string, captchaToken?: string): Promise<void>;
  logout(everywhere?: boolean): Promise<void>;
  /** undefined = sin sesión. */
  me(): Promise<Me | undefined>;

  // Análisis
  analyze(text: string): Promise<Analysis>;
  history(limit?: number): Promise<AnalysisSummary[]>;
  analysis(id: string): Promise<Analysis>;
  feedback(analysisId: string, useful: boolean, reason?: string, comment?: string): Promise<void>;
  compare(input: { topic: string; from: string; to: string; include?: string[] }): Promise<Comparison>;
  credibility(input: { outletId: string; topic: string; from: string; to: string }): Promise<CredibilityReport>;
  /** La credibilidad partida en `windows` períodos iguales (plan Profesional). */
  credibilityTimeline(input: { outletId: string; topic: string; from: string; to: string; windows: number }): Promise<TimelinePoint[]>;
  /** "¿Quién lo dijo primero?": el tema hace falta si la nota todavía no está guardada. */
  traceOrigin(url: string, topic?: string): Promise<OriginTrace>;

  // Público (sin cuenta): observatorio, medios, fe de erratas y datos abiertos
  observatory(month: string): Promise<ObservatoryReport>;
  narratives(days: number): Promise<CirculatingNarrative[]>;
  outletProfile(id: string): Promise<OutletProfile>;
  corrections(): Promise<PublicCorrection[]>;
  datasets(): Promise<OpenDataset[]>;
  datasetUrl(id: string, format: "csv" | "json"): string;

  // Catálogo público
  topics(): Promise<CategoryNode[]>;
  outlets(): Promise<Outlet[]>;
  plans(): Promise<PublicPlan[]>;

  // Cuenta
  preferences(): Promise<Preferences>;
  updatePreferences(values: Partial<Omit<Preferences, "source" | "followedTopics">>): Promise<Preferences>;
  follow(topic: string): Promise<Topic>;
  unfollow(topic: string): Promise<Topic>;
  quote(planId: string, interval: "month" | "year", coupon?: string): Promise<Quote>;
  checkout(planId: string, interval: "month" | "year", couponCode?: string): Promise<Checkout>;
  /** Cancelar: sigue hasta el fin del período pagado. Retomar: deshace la cancelación. */
  cancelSubscription(): Promise<void>;
  resumeSubscription(): Promise<void>;
  acceptLegal(docId: string, version: string): Promise<void>;
  deleteAccount(confirmation: string): Promise<void>;
  /** Link para bajar todos mis datos (Ley 25.326). */
  myDataUrl(): string;

  // Alertas
  alerts(): Promise<AlertRule[]>;
  createAlert(input: { topic: string; trigger: AlertTrigger; channel: string; outletId?: string }): Promise<AlertRule>;
  deactivateAlert(id: string): Promise<void>;

  // Claves de API (la clave completa se ve una sola vez, al crearla)
  apiKeys(): Promise<ApiKeyList>;
  createApiKey(name: string, scopes: string[]): Promise<{ plaintext: string; key: ApiKey }>;
  revokeApiKey(id: string): Promise<void>;

  // Modo aprendizaje: "¿esto es humo?"
  learningNext(): Promise<QuizQuestion>;
  learningAnswer(isSmoke: boolean): Promise<QuizResult>;
  learningProgress(): Promise<LearningProgress>;
  joinClassroom(code: string, alias: string): Promise<void>;

  // Soporte
  tickets(): Promise<Ticket[]>;
  openTicket(input: { text: string; subject?: string; category?: TicketCategory }): Promise<Ticket>;
  replyTicket(id: string, text: string): Promise<Ticket>;
  rateTicket(id: string, score: number): Promise<void>;

  // Archivo de evidencias
  evidence(): Promise<EvidenceSnapshot[]>;
  evidenceHistory(url: string): Promise<EvidenceSnapshot[]>;
  capture(url: string, monitor: boolean): Promise<EvidenceSnapshot>;
  verifyEvidence(id: string): Promise<EvidenceVerification>;
  evidenceFileUrl(id: string, kind: "raw" | "text"): string;

  // Eventos en vivo (se leen sin cuenta)
  events(): Promise<PublicEvent[]>;
  event(code: string): Promise<PublicEvent>;
  /** Mensajes en vivo; devuelve cómo desconectarse. */
  watchEvent(code: string, onEvent: (e: RoomEvent) => void, onError?: () => void): () => void;
  /** `verificacion`: chequeo del equipo (sólo quien modera). */
  postToRoom(roomId: string, text: string, kind?: "verificacion"): Promise<void>;

  /** ¿Esta foto o video ya circuló? ¿Qué dicen sus datos? (el archivo no se guarda) */
  checkMedia(file: File): Promise<MediaCheckReport>;

  // Webhooks (el secreto de firma se ve una sola vez, al crearlo)
  webhooks(): Promise<WebhookList>;
  createWebhook(url: string, events: string[]): Promise<{ webhook: Webhook; signingSecret: string }>;
  testWebhook(id: string): Promise<DeliveryResult>;
  removeWebhook(id: string): Promise<void>;

  // Calificaciones
  myReview(target: ReviewTarget): Promise<MyReview | null>;
  review(target: ReviewTarget, rating: number | null, text?: string): Promise<MyReview>;
  reviewSummary(target: ReviewTarget): Promise<RatingSummary>;

  // Mis fuentes (buzón de mail, feeds): la contraseña se guarda cifrada y nunca vuelve
  sources(): Promise<SourceList>;
  connectSource(input: { type: "rss" | "email"; name: string; config: Record<string, string>; secret?: string }): Promise<SourceConnection>;
  disconnectSource(id: string): Promise<void>;

  // Mis reglas de fuentes
  ruleSets(): Promise<RuleSetList>;
  saveRuleSet(input: { scope: "user" | "organization"; name: string; urlRules: UrlRules }): Promise<void>;
  deactivateRuleSet(id: string): Promise<void>;

  // Derecho a réplica (representantes de medios)
  myRebuttals(): Promise<PublicRebuttal[]>;
  submitRebuttal(input: { outletId: string; topic: string; statement: string; evidenceUrls: string[] }): Promise<void>;

  // Mi organización. undefined = no soy parte de ninguna.
  organization(): Promise<OrganizationOverview | undefined>;
  createOrganization(name: string): Promise<OrganizationOverview>;
  inviteMember(email: string, roleId: string): Promise<void>;
  revokeInvitation(id: string): Promise<void>;
  setMemberRole(memberId: string, roleId: string): Promise<OrganizationOverview>;
  removeMember(memberId: string): Promise<OrganizationOverview>;
  leaveOrganization(): Promise<void>;
  invitation(token: string): Promise<InvitationPreview>;
  joinOrganization(token: string): Promise<OrganizationOverview>;

  // Salas del equipo (organizaciones con plan de equipo)
  rooms(): Promise<TeamRoom[]>;
  createRoom(input: { name: string; topic?: string; slowModeSeconds?: number }): Promise<TeamRoom>;
  room(id: string): Promise<TeamRoomDetails>;
  archiveRoom(id: string): Promise<void>;
  deleteRoomMessage(messageId: string): Promise<void>;
  /** Mensajes en vivo de una sala del equipo; devuelve cómo desconectarse. */
  watchRoom(id: string, onEvent: (e: RoomEvent) => void, onError?: () => void): () => void;
}

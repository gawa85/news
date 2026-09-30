import type { PublicEvent } from "./types";
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
  FeedReadResult,
  ReclassifyReport,
  OutletArticles,
} from "./backofficeTypes";

/**
 * Lo que el BACKOFFICE necesita del servidor (puerto propio: la web de personas no depende de
 * esto — segregación de interfaces). Cada acción la controla el servidor según el permiso.
 */
export interface BackofficeApi {
  // Soporte (support:handle)
  supportQueue(): Promise<AgentTicket[]>;
  replyAsAgent(ticketId: string, text: string, opts: { internal?: boolean; status?: TicketStatus }): Promise<AgentTicket>;

  // Verificación (verdicts:write)
  verificationTasks(): Promise<VerificationTask[]>;
  takeTask(id: string): Promise<VerificationTask>;
  suggestEvidence(id: string): Promise<VerificationTask>;
  addEvidence(id: string, evidence: NewEvidence): Promise<VerificationTask>;
  resolveTask(id: string, verdicts: Record<string, VerdictStatus>, note: string): Promise<VerificationTask>;
  discardTask(id: string, note: string): Promise<VerificationTask>;

  // Réplicas de los medios (rebuttal:resolve)
  pendingRebuttals(): Promise<PendingRebuttal[]>;
  resolveRebuttal(id: string, decision: RebuttalDecision, note: string): Promise<void>;

  // Eventos en vivo (events:host)
  hostedEvents(): Promise<PublicEvent[]>;
  createEvent(input: NewEvent): Promise<{ id: string; event?: { code: string } }>;
  closeEvent(id: string): Promise<void>;
  factCheck(eventId: string, text: string): Promise<void>;
  muteAuthor(messageId: string, minutes: number, removeMessage: boolean): Promise<{ until: string }>;

  // Abuso (abuse:manage)
  restrictions(): Promise<Restriction[]>;
  restrict(input: NewRestriction): Promise<Restriction>;
  liftRestriction(id: string): Promise<Restriction>;

  // Métricas (stats:business)
  businessStats(from: string, to: string): Promise<BusinessStats>;

  // Parámetros y reglas (rules:business)
  parameters(): Promise<Parameter[]>;
  setParameter(key: string, value: ParameterValue, reason: string): Promise<void>;
  rules(): Promise<BusinessRule[]>;
  saveRule(draft: RuleDraft): Promise<BusinessRule>;
  testRule(id: string, scenarios: RuleScenario[]): Promise<RuleTestResult>;
  approveRule(id: string): Promise<BusinessRule>;
  archiveRule(id: string): Promise<void>;
  ruleHistory(id: string): Promise<BusinessRule[]>;

  // Cupones (plans:manage)
  coupons(): Promise<Coupon[]>;
  createCoupon(input: NewCoupon): Promise<Coupon>;
  deactivateCoupon(code: string): Promise<void>;

  // Funciones en prueba (flags:manage)
  flags(): Promise<FeatureFlag[]>;
  updateFlag(key: string, patch: FlagPatch): Promise<FeatureFlag>;

  // Temas y categorías (taxonomy:manage): el árbol completo, con lo desactivado
  taxonomy(): Promise<AdminCategory[]>;
  saveTopic(draft: TopicDraft): Promise<void>;
  saveCategory(draft: CategoryDraft): Promise<void>;
  /** Volver a clasificar las notas del catálogo: las que quedaron en "otros" o todas. */
  reclassifyArticles(scope: "otros" | "todas"): Promise<ReclassifyReport>;

  // Calidad del algoritmo (quality:manage)
  quality(): Promise<QualityOverview>;
  addExample(text: string, label: ExampleLabel, note?: string): Promise<LabeledExample>;
  reviewExample(id: string, label: ExampleLabel): Promise<LabeledExample>;
  evaluate(): Promise<EvaluationRun>;
  promote(versionId: string): Promise<void>;

  // Catálogo de medios (outlets:write)
  catalogSources(): Promise<CatalogSources>;
  importCatalog(sourceId: string): Promise<ImportReport>;
  importCsv(kind: CsvKind, text: string): Promise<ImportReport>;

  // Auditoría (audit:read): de a 200; para ver más viejas se pide `to` = la última mostrada.
  audit(filter: { from?: string; to?: string; action?: string }): Promise<AuditEntry[]>;

  // Costos y margen (plans:manage)
  costs(from: string, to: string): Promise<CostReport>;

  // Copias de seguridad (ops:backup)
  backups(): Promise<BackupManifest[]>;
  createBackup(): Promise<BackupManifest>;
  verifyBackup(key: string): Promise<BackupManifest>;

  // Documentos oficiales para la búsqueda de evidencia (verdicts:write)
  uploadDocument(doc: NewOfficialDocument): Promise<OfficialDocument>;

  // Personas de la plataforma (users:manage_all): por mail, teléfono o id exactos
  roleCatalog(): Promise<RoleInfo[]>;
  searchUsers(q: string, filter: UserListFilter): Promise<AdminUser[]>;
  addUserRole(userId: string, roleId: string): Promise<AdminUser>;
  removeUserRole(userId: string, roleId: string): Promise<AdminUser>;
  suspendUser(userId: string, reason: string): Promise<AdminUser>;
  reactivateUser(userId: string, reason: string): Promise<AdminUser>;
  addRepresentedOutlet(userId: string, outletId: string): Promise<AdminUser>;
  removeRepresentedOutlet(userId: string, outletId: string): Promise<AdminUser>;

  // Medios del catálogo (outlets:write): datos y feeds de uno en particular
  outletRecord(id: string): Promise<OutletRecord>;
  saveOutlet(draft: OutletDraft): Promise<AdminOutlet>;
  addOutletFeed(outletId: string, url: string): Promise<OutletFeed>;
  setOutletFeedActive(outletId: string, feedId: string, active: boolean): Promise<OutletFeed>;
  /** Leer un feed ahora (una vez por minuto) o todos, en segundo plano (una vez cada 5 minutos). */
  readOutletFeed(outletId: string, feedId: string): Promise<FeedReadResult>;
  readAllFeeds(): Promise<{ queued: boolean }>;
  /** Las últimas notas leídas de un medio, con su tema. */
  outletArticles(outletId: string): Promise<OutletArticles>;

  // Fe de erratas (corrections:publish): corregir públicamente un error propio
  publishCorrection(input: NewCorrection): Promise<{ id: string }>;

  // Planes (plans:manage): el precio nuevo vale para las suscripciones nuevas
  planCatalog(): Promise<PlanCatalog>;
  updatePlan(id: string, patch: PlanPatch): Promise<AdminPlan>;
  resetPlan(id: string): Promise<AdminPlan>;
  createPlan(input: NewPlan): Promise<AdminPlan>;
  setPlanForSale(id: string, forSale: boolean): Promise<AdminPlan>;
  // Mudar suscriptores de un plan a otro, con aviso previo
  planMigrations(): Promise<PlanMigration[]>;
  /** Días de aviso mínimos para pasar de un plan a otro. */
  migrationNotice(fromPlanId: string, toPlanId: string): Promise<number>;
  scheduleMigration(input: NewPlanMigration): Promise<PlanMigration>;
  cancelMigration(id: string): Promise<PlanMigration>;

  // Documentos legales (legal:publish): cada publicación es una versión nueva
  publishLegal(docId: "terms" | "privacy", input: NewLegalVersion): Promise<{ version: string }>;

  // Puesta en marcha (users:manage_all)
  setup(): Promise<SetupOverview>;
  saveSetupProfile(input: PlatformProfile): Promise<PlatformProfile>;
  /** Publica borradores de términos y privacidad con los datos de la empresa completos. */
  fillLegal(): Promise<FillLegalResult>;

  // Directorio de fuentes públicas para el catálogo (outlets:write)
  catalogDirectory(): Promise<CatalogDirectoryEntry[]>;
  importDirectory(ids: string[]): Promise<{ outlets: number; feeds: number }>;
  verifyDirectory(): Promise<DirectoryCheck[]>;
}

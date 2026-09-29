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
}

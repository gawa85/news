import type { PublicEvent } from "./types";
import type {
  AgentTicket,
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

  // Funciones en prueba (flags:manage)
  flags(): Promise<FeatureFlag[]>;
  updateFlag(key: string, patch: FlagPatch): Promise<FeatureFlag>;
}

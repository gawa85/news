import type { BackofficeApi } from "./BackofficeApi";
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
} from "./backofficeTypes";
import { jsonRequest, type Fetch } from "./http";
import type { PublicEvent } from "./types";

const enc = encodeURIComponent;

/** Adaptador HTTP del backoffice (misma sesión por cookie que la web de personas). */
export class HttpBackofficeApi implements BackofficeApi {
  constructor(
    private readonly base = "",
    private readonly fetchFn: Fetch = (...args) => fetch(...args),
  ) {}

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return jsonRequest<T>(this.fetchFn, this.base, method, path, body);
  }

  supportQueue() {
    return this.request<AgentTicket[]>("GET", "/v1/support/queue");
  }
  replyAsAgent(ticketId: string, text: string, opts: { internal?: boolean; status?: TicketStatus }) {
    return this.request<AgentTicket>("POST", `/v1/support/tickets/${enc(ticketId)}/reply`, { text, ...opts });
  }

  verificationTasks() {
    return this.request<VerificationTask[]>("GET", "/v1/verification/tasks");
  }
  takeTask(id: string) {
    return this.request<VerificationTask>("POST", `/v1/verification/tasks/${enc(id)}/take`);
  }
  suggestEvidence(id: string) {
    return this.request<VerificationTask>("POST", `/v1/verification/tasks/${enc(id)}/suggest`);
  }
  addEvidence(id: string, evidence: NewEvidence) {
    return this.request<VerificationTask>("POST", `/v1/verification/tasks/${enc(id)}/evidence`, evidence);
  }
  resolveTask(id: string, verdicts: Record<string, VerdictStatus>, note: string) {
    return this.request<VerificationTask>("POST", `/v1/verification/tasks/${enc(id)}/resolve`, { verdicts, note });
  }
  discardTask(id: string, note: string) {
    return this.request<VerificationTask>("POST", `/v1/verification/tasks/${enc(id)}/discard`, { note });
  }

  pendingRebuttals() {
    return this.request<PendingRebuttal[]>("GET", "/v1/rebuttals");
  }
  async resolveRebuttal(id: string, decision: RebuttalDecision, note: string) {
    await this.request("POST", `/v1/rebuttals/${enc(id)}/resolve`, { decision, note });
  }

  hostedEvents() {
    return this.request<PublicEvent[]>("GET", "/v1/events");
  }
  createEvent(input: NewEvent) {
    return this.request<{ id: string; event?: { code: string } }>("POST", "/v1/events", input);
  }
  async closeEvent(id: string) {
    await this.request("POST", `/v1/events/${enc(id)}/close`);
  }
  async factCheck(eventId: string, text: string) {
    await this.request("POST", `/v1/events/${enc(eventId)}/factcheck`, { text });
  }
  muteAuthor(messageId: string, minutes: number, removeMessage: boolean) {
    // La sala sale del mensaje: el id de la ruta no se usa.
    return this.request<{ until: string }>("POST", `/v1/events/-/mute`, { messageId, minutes, remove: removeMessage });
  }

  restrictions() {
    return this.request<Restriction[]>("GET", "/v1/abuse/restrictions?limit=200");
  }
  restrict(input: NewRestriction) {
    return this.request<Restriction>("POST", "/v1/abuse/restrictions", input);
  }
  liftRestriction(id: string) {
    return this.request<Restriction>("POST", `/v1/abuse/restrictions/${enc(id)}/lift`);
  }

  businessStats(from: string, to: string) {
    return this.request<BusinessStats>("GET", `/v1/stats/business?from=${enc(from)}&to=${enc(to)}`);
  }

  parameters() {
    return this.request<Parameter[]>("GET", "/v1/parameters");
  }
  async setParameter(key: string, value: ParameterValue, reason: string) {
    await this.request("PUT", `/v1/parameters/${enc(key)}`, { value, reason });
  }
  rules() {
    return this.request<BusinessRule[]>("GET", "/v1/business-rules");
  }
  saveRule(draft: RuleDraft) {
    return this.request<BusinessRule>("POST", "/v1/business-rules", draft);
  }
  testRule(id: string, scenarios: RuleScenario[]) {
    return this.request<RuleTestResult>("POST", `/v1/business-rules/${enc(id)}/test`, { scenarios });
  }
  approveRule(id: string) {
    return this.request<BusinessRule>("POST", `/v1/business-rules/${enc(id)}/approve`);
  }
  async archiveRule(id: string) {
    await this.request("POST", `/v1/business-rules/${enc(id)}/archive`);
  }
  ruleHistory(id: string) {
    return this.request<BusinessRule[]>("GET", `/v1/business-rules/${enc(id)}/history`);
  }

  coupons() {
    return this.request<Coupon[]>("GET", "/v1/coupons");
  }
  createCoupon(input: NewCoupon) {
    return this.request<Coupon>("POST", "/v1/coupons", input);
  }
  async deactivateCoupon(code: string) {
    await this.request("POST", `/v1/coupons/${enc(code)}/deactivate`);
  }

  flags() {
    return this.request<FeatureFlag[]>("GET", "/v1/flags");
  }
  updateFlag(key: string, patch: FlagPatch) {
    return this.request<FeatureFlag>("PATCH", `/v1/flags/${enc(key)}`, patch);
  }
}

import { randomUUID } from "node:crypto";
import { AccessDeniedError } from "../../domain/errors";
import type { CostEvent, CostKind, CostReport, PriceTable, SubjectCost } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  ICostRepository,
  IMetrics,
  IPlanRepository,
  IRequestContext,
  ISubscriptionRepository,
  IUserRepository,
} from "../../domain/ports";

/**
 * Registra el costo de cada consumo (tokens de IA, mensajes, mails…) y lo atribuye
 * al cliente del pedido en curso (contexto), sin que cada adaptador tenga que saberlo.
 */
export class CostTracker {
  constructor(
    private readonly repo: ICostRepository,
    private readonly prices: PriceTable,
    private readonly context: IRequestContext,
    private readonly clock: IClock,
    private readonly metrics: IMetrics,
  ) {}

  async llm(model: string, inputTokens: number, outputTokens: number): Promise<void> {
    const p = this.prices.llm[model] ?? this.prices.llm.default;
    const cost = p ? (inputTokens * p.inputPerMillionTokensUsd + outputTokens * p.outputPerMillionTokensUsd) / 1_000_000 : 0;
    this.metrics.increment("sinhumo_llm_tokens_total", { direction: "input", model }, inputTokens);
    this.metrics.increment("sinhumo_llm_tokens_total", { direction: "output", model }, outputTokens);
    await this.record("llm", model, { inputTokens, outputTokens }, cost);
  }

  async message(channel: string): Promise<void> {
    await this.record(channel === "email" ? "email" : "message", channel, { messages: 1 }, this.prices.perMessageUsd[channel] ?? 0);
  }

  async units(kind: CostKind, provider: string, units: CostEvent["units"], costUsd: number): Promise<void> {
    await this.record(kind, provider, units, costUsd);
  }

  private async record(kind: CostKind, provider: string, units: CostEvent["units"], costUsd: number): Promise<void> {
    const ctx = this.context.current();
    this.metrics.increment("sinhumo_cost_usd_total", { provider }, costUsd);
    await this.repo.record({ id: randomUUID(), subjectId: ctx?.subjectId ?? "sistema", userId: ctx?.userId, action: ctx?.action, kind, provider, units, costUsd, at: this.clock.now() });
  }
}

export interface CostPolicy {
  /** Cotización para comparar precios en pesos con costos en dólares (actualizarla). */
  usdToArs: number;
  /** En planes pagos: alerta si el costo supera esta porción del ingreso. */
  maxCostShare: number;
  /** En el plan gratis: alerta si el costo mensual supera este monto. */
  freeTierMaxUsd: number;
}

/**
 * Reporte de costos y margen por cliente. Para quien administra la plataforma:
 * muestra si cada plan deja margen y qué clientes cuestan más de lo que pagan.
 */
export class CostReportUseCase {
  constructor(
    private readonly costs: ICostRepository,
    private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: IPlanRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly policy: CostPolicy,
  ) {}

  async execute(input: { actorId: string; from: Date; to: Date }): Promise<CostReport> {
    const actor = await this.users.findById(input.actorId);
    const perms = actor ? await this.authz.permissionsOf(actor) : new Set();
    if (!perms.has("plans:manage") && !perms.has("users:manage_all")) throw new AccessDeniedError("Sólo la administración ve los costos.", "no_permission");

    const events = await this.costs.findBetween(input.from, input.to);
    const months = Math.max(1, (input.to.getTime() - input.from.getTime()) / (30.44 * 86_400_000));
    const byProvider: Record<string, number> = {};
    const bySubjectCost = new Map<string, number>();
    for (const e of events) {
      byProvider[e.provider] = (byProvider[e.provider] ?? 0) + e.costUsd;
      bySubjectCost.set(e.subjectId, (bySubjectCost.get(e.subjectId) ?? 0) + e.costUsd);
    }

    const bySubject: SubjectCost[] = [];
    for (const [subjectId, costUsd] of bySubjectCost) {
      const sub = (await this.subscriptions.findCurrent({ type: "user", id: subjectId })) ?? (await this.subscriptions.findCurrent({ type: "organization", id: subjectId }));
      const plan = sub ? await this.plans.findById(sub.planId) : undefined;
      const monthly = plan?.price ? (plan.price.interval === "year" ? plan.price.amount / 12 : plan.price.amount) : 0;
      const revenueUsd = round((monthly * months) / this.policy.usdToArs);
      const costShare = revenueUsd > 0 ? round(costUsd / revenueUsd) : null;
      const overBudget = revenueUsd > 0 ? costUsd > revenueUsd * this.policy.maxCostShare : costUsd / months > this.policy.freeTierMaxUsd;
      bySubject.push({ subjectId, planId: plan?.id, revenueUsd, costUsd: round(costUsd), marginUsd: round(revenueUsd - costUsd), costShare, overBudget });
    }
    bySubject.sort((a, b) => b.costUsd - a.costUsd);
    return {
      period: { from: input.from, to: input.to },
      totalCostUsd: round(events.reduce((s, e) => s + e.costUsd, 0)),
      totalRevenueUsd: round(bySubject.reduce((s, x) => s + x.revenueUsd, 0)),
      byProvider: Object.fromEntries(Object.entries(byProvider).map(([k, v]) => [k, round(v)])),
      bySubject,
    };
  }
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

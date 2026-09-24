import { evaluateDeclarative, factsFrom } from "../../domain/rules/declarativeRules";
import { AccessDeniedError, NotFoundError } from "../../domain/errors";
import {
  formatPrice,
  withinLimit,
  type AccessContext,
  type ActionId,
  type BillingSubject,
  type ChannelType,
  type Feature,
  type Permission,
  type Plan,
  type RuleDecision,
  type User,
} from "../../domain/model";
import type {
  IAuthorizationService,
  IBusinessRule,
  IClock,
  IPlanRepository,
  ISubscriptionRepository,
  IUsageRepository,
  IDeclarativeRuleSource,
  IUserRepository,
} from "../../domain/ports";
import { ACTIONS } from "./ActionCatalog";

/** El usuario paga como individuo o a través de su organización. */
export function billingSubjectOf(user: User): BillingSubject {
  return user.organizationId ? { type: "organization", id: user.organizationId } : { type: "user", id: user.id };
}

/** Motor de reglas: corre la lista en orden y corta en la primera denegación. */
export class BusinessRuleEngine {
  constructor(private readonly rules: IBusinessRule[]) {}

  evaluate(ctx: AccessContext): RuleDecision & { ruleId?: string } {
    for (const rule of this.rules) {
      const d = rule.check(ctx);
      if (!d.allowed) return { ...d, ruleId: rule.id };
    }
    return { allowed: true };
  }
}

/** Sugiere el plan más barato que resolvería la denegación. Útil para vender el upgrade. */
export class UpgradeAdvisor {
  constructor(private readonly plans: IPlanRepository) {}

  async suggest(ctx: AccessContext, decision: RuleDecision): Promise<string | undefined> {
    if (decision.allowed) return undefined;
    const candidates = (await this.plans.findAll()).filter((p) => p.tier > ctx.plan.tier && p.audience === ctx.plan.audience);
    const fix = candidates.find((p) => this.solves(p, ctx, decision));
    return fix ? `Disponible en el plan ${fix.name} (${formatPrice(fix.price)}).` : undefined;
  }

  private solves(p: Plan, ctx: AccessContext, d: Extract<RuleDecision, { allowed: false }>): boolean {
    switch (d.code) {
      case "feature_not_in_plan":
        return p.features.includes((d.feature ?? ctx.action.feature) as Feature);
      case "channel_not_in_plan":
        return p.channels.includes(ctx.channel);
      case "quota_exceeded": {
        const m = ctx.action.metric!;
        return withinLimit(m === "analyses" ? p.limits.analysesPerDay : p.limits.comparisonsPerMonth, ctx.usage[m] + 1);
      }
      case "limit_exceeded":
        return withinLimit(p.limits.maxIncludeUrls, ctx.request.includeUrls ?? 0);
      default:
        return false;
    }
  }
}

export interface AccessControlOptions {
  /** Para cortar el "día" y el "mes" de las cuotas en hora local (Argentina = -180). */
  utcOffsetMinutes: number;
}

/**
 * Carga todo lo necesario (usuario, permisos, plan, uso), ejecuta las reglas
 * y, si se permite, registra el consumo. Es el único punto de control de acceso.
 */
export class AccessControl {
  constructor(
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: IPlanRepository,
    private readonly usage: IUsageRepository,
    private readonly engine: BusinessRuleEngine,
    private readonly advisor: UpgradeAdvisor,
    private readonly clock: IClock,
    private readonly opts: AccessControlOptions = { utcOffsetMinutes: -180 },
    /** Reglas configurables (datos). Las fijas del motor corren siempre y primero. */
    private readonly declarative?: IDeclarativeRuleSource,
  ) {}

  async authorize(
    userId: string,
    actionId: ActionId,
    channel: ChannelType,
    request: AccessContext["request"] = {},
    scopes?: ReadonlySet<Permission>,
  ): Promise<AccessContext> {
    let ctx = await this.load(userId, actionId, channel, request, scopes);
    const outcome = this.declarative
      ? evaluateDeclarative(await this.declarative.rulesFor(ctx.user.organizationId), factsFrom(ctx, this.opts.utcOffsetMinutes), ctx.now)
      : { grants: [] };
    // Promociones: suman funcionalidades al plan SÓLO para este pedido (nunca permisos del rol).
    if (outcome.grants.length) ctx = { ...ctx, plan: { ...ctx.plan, features: [...new Set([...ctx.plan.features, ...outcome.grants.map((g) => g.feature)])] } };
    const decision = this.engine.evaluate(ctx);
    if (!decision.allowed) {
      throw new AccessDeniedError(decision.message, decision.code, await this.advisor.suggest(ctx, decision));
    }
    if (outcome.denial) throw new AccessDeniedError(outcome.denial.message, outcome.denial.code);
    return ctx;
  }

  async recordUsage(ctx: AccessContext): Promise<void> {
    if (!ctx.action.metric) return;
    await this.usage.record({ subjectId: ctx.subscription.subject.id, metric: ctx.action.metric, userId: ctx.user.id, at: ctx.now });
  }

  async userOrThrow(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError(`No existe el usuario ${userId}.`);
    return user;
  }

  /** Usos consumidos hoy / este mes (para mostrarlos). */
  async usageOf(user: User): Promise<{ analyses: number; comparisons: number }> {
    const subject = billingSubjectOf(user);
    const now = this.clock.now();
    return {
      analyses: await this.usage.count(subject.id, "analyses", this.startOf("day", now)),
      comparisons: await this.usage.count(subject.id, "comparisons", this.startOf("month", now)),
    };
  }

  /** Plan vigente de un usuario (para mostrarlo o aplicar límites). */
  async planOf(user: User): Promise<{ plan: Plan; subject: BillingSubject }> {
    const subject = billingSubjectOf(user);
    const sub = await this.subscriptions.findCurrent(subject);
    const plan = sub && (await this.plans.findById(sub.planId));
    if (!sub || !plan) throw new NotFoundError("El usuario no tiene suscripción.");
    return { plan, subject };
  }

  private async load(
    userId: string,
    actionId: ActionId,
    channel: ChannelType,
    request: AccessContext["request"],
    scopes?: ReadonlySet<Permission>,
  ): Promise<AccessContext> {
    const user = await this.userOrThrow(userId);
    const subject = billingSubjectOf(user);
    const subscription = await this.subscriptions.findCurrent(subject);
    if (!subscription) throw new AccessDeniedError("No tenés una suscripción.", "subscription_inactive");
    const plan = await this.plans.findById(subscription.planId);
    if (!plan) throw new NotFoundError(`No existe el plan ${subscription.planId}.`);

    const now = this.clock.now();
    const [analyses, comparisons] = await Promise.all([
      this.usage.count(subject.id, "analyses", this.startOf("day", now)),
      this.usage.count(subject.id, "comparisons", this.startOf("month", now)),
    ]);

    // Con clave de API: sólo lo que el rol permite Y la clave habilita.
    const rolePerms = await this.authz.permissionsOf(user);
    const permissions = scopes ? new Set([...rolePerms].filter((p) => scopes.has(p))) : rolePerms;

    return {
      user,
      permissions,
      plan,
      subscription,
      usage: { analyses, comparisons },
      action: ACTIONS[actionId],
      channel,
      request,
      now,
    };
  }

  private startOf(unit: "day" | "month", now: Date): Date {
    const off = this.opts.utcOffsetMinutes * 60_000;
    const local = new Date(now.getTime() + off);
    const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), unit === "month" ? 1 : local.getUTCDate());
    return new Date(start - off);
  }
}

/**
 * REGLAS DE NEGOCIO de acceso. Son funciones puras del dominio: reciben el
 * contexto ya cargado y deciden. No leen la base ni llaman APIs, así que
 * se prueban con un objeto armado a mano.
 *
 * Orden recomendado (el motor corta en la primera que deniega):
 *   usuario activo → suscripción vigente → permiso (rol) → funcionalidad (plan)
 *   → canal (plan) → cuotas → límites del pedido
 */
import { ALLOW, isUsable, withinLimit, type AccessContext, type RuleDecision, type UsageMetric } from "../model";
import type { IBusinessRule } from "../ports";

export class ActiveUserRule implements IBusinessRule {
  readonly id = "active_user";
  check(ctx: AccessContext): RuleDecision {
    return ctx.user.status === "active"
      ? ALLOW
      : { allowed: false, code: "user_inactive", message: "Tu cuenta está suspendida. Escribinos para revisarla." };
  }
}

export class ActiveSubscriptionRule implements IBusinessRule {
  readonly id = "active_subscription";
  check(ctx: AccessContext): RuleDecision {
    return isUsable(ctx.subscription, ctx.now)
      ? ALLOW
      : { allowed: false, code: "subscription_inactive", message: "Tu suscripción no está activa (pago pendiente o vencida)." };
  }
}

/** El ROL decide qué le corresponde hacer a la persona. */
export class PermissionRule implements IBusinessRule {
  readonly id = "permission";
  check(ctx: AccessContext): RuleDecision {
    return ctx.permissions.has(ctx.action.permission)
      ? ALLOW
      : { allowed: false, code: "no_permission", message: "Tu rol no tiene permiso para esta acción. Pedíselo al administrador de tu organización." };
  }
}

/** El PLAN decide qué funcionalidades están pagas. */
export class FeatureInPlanRule implements IBusinessRule {
  readonly id = "feature_in_plan";
  check(ctx: AccessContext): RuleDecision {
    return ctx.plan.features.includes(ctx.action.feature)
      ? ALLOW
      : { allowed: false, code: "feature_not_in_plan", message: `Esta función no está incluida en el plan ${ctx.plan.name}.`, feature: ctx.action.feature };
  }
}

export class ChannelInPlanRule implements IBusinessRule {
  readonly id = "channel_in_plan";
  check(ctx: AccessContext): RuleDecision {
    return ctx.plan.channels.includes(ctx.channel)
      ? ALLOW
      : { allowed: false, code: "channel_not_in_plan", message: `El canal ${ctx.channel} no está incluido en el plan ${ctx.plan.name}.` };
  }
}

/** Cuota diaria de análisis y mensual de comparaciones. */
export class QuotaRule implements IBusinessRule {
  readonly id = "quota";
  check(ctx: AccessContext): RuleDecision {
    const metric: UsageMetric | undefined = ctx.action.metric;
    if (!metric) return ALLOW;
    const limit = metric === "analyses" ? ctx.plan.limits.analysesPerDay : ctx.plan.limits.comparisonsPerMonth;
    if (withinLimit(limit, ctx.usage[metric] + 1)) return ALLOW;
    const period = metric === "analyses" ? "hoy" : "este mes";
    return {
      allowed: false,
      code: "quota_exceeded",
      message: `Llegaste al límite de tu plan: ${limit} ${metric === "analyses" ? "análisis" : "comparaciones"} ${period}.`,
    };
  }
}

/** Límite de URLs que el usuario puede forzar en una comparación. */
export class IncludeUrlsLimitRule implements IBusinessRule {
  readonly id = "include_urls_limit";
  check(ctx: AccessContext): RuleDecision {
    const n = ctx.request.includeUrls ?? 0;
    if (n === 0) return ALLOW;
    if (!ctx.plan.features.includes("url_rules") || ctx.plan.limits.maxIncludeUrls === 0) {
      return { allowed: false, code: "feature_not_in_plan", message: "Elegir URLs a incluir no está en tu plan.", feature: "url_rules" };
    }
    return withinLimit(ctx.plan.limits.maxIncludeUrls, n)
      ? ALLOW
      : { allowed: false, code: "limit_exceeded", message: `Tu plan permite incluir hasta ${ctx.plan.limits.maxIncludeUrls} URLs por comparación.` };
  }
}

export function defaultAccessRules(): IBusinessRule[] {
  return [
    new ActiveUserRule(),
    new ActiveSubscriptionRule(),
    new PermissionRule(),
    new FeatureInPlanRule(),
    new ChannelInPlanRule(),
    new QuotaRule(),
    new IncludeUrlsLimitRule(),
  ];
}

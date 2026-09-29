import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import { FEATURES, type Feature, type Plan, type PlanLimits, type Price, type User } from "../../domain/model";
import type { IAuthorizationService, IClock, IDomainEvents, IPlanRepository, IPlanWriter, ISubscriptionRepository, IUserRepository } from "../../domain/ports";
import { planReductions } from "../../domain/rules/pricing";

export interface AdminPlan extends Plan {
  /** Suscripciones vigentes (activas, en prueba o con pago atrasado). */
  liveSubscriptions: number;
}

/** Lo que se puede cambiar de un plan desde el backoffice (el resto es del código: id, tier, audiencia, canales). */
export interface PlanPatch {
  name: string;
  description: string;
  /** Montos en la moneda del plan; `undefined` en un plan gratis. */
  monthlyAmount?: number;
  yearlyAmount?: number | null;
  features: Feature[];
  limits: PlanLimits;
}

const LIMIT_KEYS: (keyof PlanLimits)[] = ["analysesPerDay", "comparisonsPerMonth", "maxSourcesPerComparison", "maxIncludeUrls", "maxSavedRuleSets", "maxAlerts", "maxSourceConnections", "seats"];

/**
 * PLANES (permiso `plans:manage`): nombre, descripción, precios, límites y funciones.
 * REGLAS:
 *  - Un cambio de precio vale para las suscripciones NUEVAS: quien ya paga sigue con lo que
 *    contrató (cada suscripción guarda lo que se le cobra).
 *  - Con suscripciones vigentes no se le QUITA nada a un plan (funciones o límites más bajos):
 *    para eso se crea otro plan. Agregar sí se puede siempre.
 *  - Un plan gratis sigue gratis y uno pago sigue pago (lo usan el vencimiento y las altas).
 *  - Un plan editado queda "personalizado": el arranque ya no lo pisa con la versión del código.
 *    Se puede volver a esa versión (con las mismas reglas).
 */
export class PlanAdmin {
  constructor(
    private readonly plans: IPlanRepository & IPlanWriter,
    private readonly subscriptions: ISubscriptionRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    /** Los planes como vienen en el código (para restablecer). */
    private readonly defaults: Plan[],
    private readonly featureLabels: Record<Feature, string>,
  ) {}

  /** Los planes (con cuántas suscripciones vigentes tiene cada uno) y todas las funciones que se pueden vender. */
  async list(actorId: string): Promise<{ plans: AdminPlan[]; features: { id: Feature; label: string }[] }> {
    await this.manager(actorId);
    const all = (await this.plans.findAll()).sort((a, b) => a.tier - b.tier);
    return {
      plans: await Promise.all(all.map(async (p) => ({ ...p, liveSubscriptions: await this.subscriptions.countLive(p.id) }))),
      features: FEATURES.map((id) => ({ id, label: this.featureLabels[id] ?? id })),
    };
  }

  async update(actorId: string, planId: string, patch: PlanPatch): Promise<AdminPlan> {
    const actor = await this.manager(actorId);
    const before = await this.plan(planId);
    const name = text(patch.name, 60);
    const description = text(patch.description, 300);
    if (!name) throw new ValidationError("Falta el nombre del plan.");
    const features = Array.isArray(patch.features) ? [...new Set(patch.features)] : null;
    if (!features || features.some((f) => !(FEATURES as readonly string[]).includes(f))) throw new ValidationError("Función desconocida.");
    const after: Plan = {
      ...before,
      name,
      description,
      price: before.price ? { ...before.price, amount: amount(patch.monthlyAmount, "El precio") } : null,
      yearlyPrice: yearly(before, patch.yearlyAmount),
      features,
      limits: limits(patch.limits),
      customized: { at: this.clock.now(), by: actor.id },
    };
    return this.apply(actor, before, after);
  }

  async reset(actorId: string, planId: string): Promise<AdminPlan> {
    const actor = await this.manager(actorId);
    const before = await this.plan(planId);
    const original = this.defaults.find((p) => p.id === planId);
    if (!original) throw new NotFoundError("Ese plan no viene en el código: no hay versión a la que volver.");
    return this.apply(actor, before, { ...original, customized: undefined });
  }

  private async apply(actor: User, before: Plan, after: Plan): Promise<AdminPlan> {
    const live = await this.subscriptions.countLive(before.id);
    const reductions = planReductions(before, after);
    if (live > 0 && reductions.length) {
      throw new ConflictError(`El plan tiene ${live} suscripción(es) vigente(s) y el cambio les quita algo (${reductions.join("; ")}). Para eso, creá otro plan.`);
    }
    await this.plans.save(after);
    await this.events.emit("plan.changed", { userId: actor.id }, {
      reset: !after.customized,
      price: after.price?.amount ?? null, priceBefore: before.price?.amount ?? null,
      yearlyPrice: after.yearlyPrice?.amount ?? null,
      featuresAdded: after.features.filter((f) => !before.features.includes(f)),
      featuresRemoved: before.features.filter((f) => !after.features.includes(f)),
    }, { type: "plan", id: after.id });
    return { ...after, liveSubscriptions: live };
  }

  private async plan(planId: string): Promise<Plan> {
    const p = await this.plans.findById(planId);
    if (!p) throw new NotFoundError("No existe ese plan.");
    return p;
  }

  private async manager(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("plans:manage")) throw new AccessDeniedError("No tenés permiso para editar planes.", "no_permission");
    return u;
  }
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function amount(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 100_000_000) throw new ValidationError(`${what} tiene que ser un número mayor que cero.`);
  return Math.round(v * 100) / 100;
}

function yearly(before: Plan, v: unknown): Price | undefined {
  if (!before.price) return undefined;
  if (v === null || v === undefined) return undefined;
  return { amount: amount(v, "El precio anual"), currency: before.price.currency, interval: "year" };
}

function limits(v: unknown): PlanLimits {
  if (typeof v !== "object" || !v) throw new ValidationError("Faltan los límites.");
  const src = v as Record<string, unknown>;
  const out = {} as PlanLimits;
  for (const k of LIMIT_KEYS) {
    const x = src[k];
    if (x === null) out[k] = null;
    else if (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 1_000_000) out[k] = x;
    else throw new ValidationError(`Límite inválido: ${k} (un entero desde 0, o sin límite).`);
  }
  return out;
}

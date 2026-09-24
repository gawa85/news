import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import { withinLimit, type BillingInterval, type BillingSubject, type Organization, type PriceQuote, type Subscription } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IDomainEvents,
  IIdGenerator,
  IPaymentGateway,
  IPlanRepository,
  ISubscriptionRepository,
  IUnitOfWork,
  IUserRepository,
} from "../../domain/ports";
import { billingSubjectOf } from "../access/AccessControl";

/**
 * Cambio de plan (upgrade / downgrade).
 * REGLAS:
 *  - Un usuario individual cambia su propio plan; en una organización sólo quien
 *    tiene `subscriptions:manage_org`.
 *  - Los planes de organización son para organizaciones y viceversa.
 *  - Downgrade: la organización no puede tener más miembros que asientos del plan nuevo.
 *  - Plan pago → la suscripción queda "pendiente de pago" hasta que el proveedor confirme.
 */
export class ChangePlanUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly plans: IPlanRepository,
    private readonly authz: IAuthorizationService,
    private readonly payments: IPaymentGateway,
    private readonly uow: IUnitOfWork,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly events: IDomainEvents,
    /** Precios por país, plan anual y cupones. */
    private readonly pricing?: { quote(input: { userId: string; planId: string; interval: BillingInterval; couponCode?: string }): Promise<PriceQuote> },
  ) {}

  async execute(input: { actorId: string; planId: string; interval?: BillingInterval; couponCode?: string }): Promise<{ subscription: Subscription; checkoutUrl?: string; quote?: PriceQuote }> {
    const actor = await this.users.findById(input.actorId);
    if (!actor) throw new NotFoundError("Usuario inexistente.");
    const plan = await this.plans.findById(input.planId);
    if (!plan) throw new NotFoundError(`No existe el plan ${input.planId}.`);

    const subject = billingSubjectOf(actor);
    if (subject.type === "organization") {
      const perms = await this.authz.permissionsOf(actor);
      if (!perms.has("subscriptions:manage_org")) throw new AccessDeniedError("Sólo un administrador puede cambiar el plan de la organización.", "no_permission");
      if (plan.audience !== "organization") throw new ValidationError(`El plan ${plan.name} es para personas, no para organizaciones.`);
      const members = await this.users.findByOrganization(subject.id);
      if (!withinLimit(plan.limits.seats, members.length)) {
        throw new ConflictError(`El plan ${plan.name} permite ${plan.limits.seats} miembros y la organización tiene ${members.length}.`);
      }
    } else if (plan.audience !== "individual") {
      throw new ValidationError(`El plan ${plan.name} es para organizaciones. Creá una organización primero.`);
    }

    const now = this.clock.now();
    const interval: BillingInterval = input.interval ?? (plan.price?.interval === "year" ? "year" : "month");
    if (!plan.price && input.couponCode) throw new ValidationError("Los planes gratis no llevan cupón.");
    const q = plan.price && this.pricing ? await this.pricing.quote({ userId: actor.id, planId: plan.id, interval, couponCode: input.couponCode }) : undefined;
    const free = !plan.price || q?.amount === 0;
    const subscription: Subscription = {
      id: this.ids.next("sub"),
      subject,
      planId: plan.id,
      status: free ? "active" : "pending_payment",
      currentPeriodEnd: new Date(now.getTime() + (interval === "year" ? 365 : 31) * 86_400_000),
      createdAt: now,
      ...(plan.price ? { interval } : {}),
      ...(q ? { charged: { amount: q.amount, currency: q.currency, listAmount: q.listAmount, couponCode: q.coupon?.code, discountCycles: q.coupon?.cycles, country: q.country } } : {}),
    };

    // Una suscripción "pendiente de pago" se guarda pero no cuenta como vigente:
    // el usuario sigue con su plan anterior hasta que el proveedor confirme el cobro.
    await this.uow.transaction(async (r) => {
      if (subscription.status === "active") await replaceCurrent(r.subscriptions, subject, now);
      await r.subscriptions.save(subscription);
    });
    await this.events.emit("plan.change_requested", { userId: actor.id, organizationId: actor.organizationId }, { planId: plan.id, status: subscription.status, interval, coupon: input.couponCode }, { type: "subscription", id: subscription.id });
    if (!plan.price) return { subscription };
    if (free) {
      // Cupón del 100%: se activa sin pasar por el cobro (igual cuenta como uso del cupón).
      await this.events.emit("payment.confirmed", { userId: actor.id, organizationId: actor.organizationId }, { planId: plan.id, amount: 0 }, { type: "subscription", id: subscription.id });
      return { subscription, quote: q };
    }
    const { checkoutUrl } = await this.payments.createCheckout(subscription, plan);
    return { subscription, checkoutUrl, quote: q };
  }
}

/** Marca como reemplazada la suscripción vigente (en la misma transacción que la nueva). */
async function replaceCurrent(subs: ISubscriptionRepository, subject: BillingSubject, at: Date): Promise<void> {
  const current = await subs.findCurrent(subject);
  if (current) await subs.save({ ...current, status: "replaced", endedAt: at });
}

/** Lo llama el webhook del proveedor de pagos cuando el cobro se acredita. */
export class ConfirmPaymentUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly events: IDomainEvents,
    private readonly clock?: IClock,
  ) {}

  /** Idempotente: si el proveedor avisa dos veces, no pasa nada. */
  async execute(input: { subscriptionId: string }): Promise<Subscription> {
    return this.uow.transaction(async (r) => {
      const sub = await r.subscriptions.findById(input.subscriptionId);
      if (!sub) throw new NotFoundError("No existe esa suscripción.");
      if (sub.status === "active") return sub;
      if (sub.status !== "pending_payment") throw new ConflictError(`La suscripción está en estado ${sub.status}.`);
      const active: Subscription = { ...sub, status: "active" };
      await replaceCurrent(r.subscriptions, sub.subject, this.clock?.now() ?? new Date());
      await r.subscriptions.save(active);
      return active;
    }).then(async (active) => {
      const actor = active.subject.type === "organization" ? { userId: "sistema:pagos", organizationId: active.subject.id } : { userId: active.subject.id };
      await this.events.emit("payment.confirmed", actor, { planId: active.planId, amount: active.charged?.amount, currency: active.charged?.currency, country: active.charged?.country }, { type: "subscription", id: active.id });
      return active;
    });
  }
}

/** Crear una organización: quien la crea pasa a ser su administrador. */
export class CreateOrganizationUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly config: { adminRoleId: string; defaultPlanId: string },
    private readonly events: IDomainEvents,
  ) {}

  async execute(input: { ownerId: string; name: string }): Promise<Organization> {
    const now = this.clock.now();
    const org: Organization = { id: this.ids.next("org"), name: input.name, createdAt: now };
    await this.uow.transaction(async (r) => {
      const owner = await r.users.findById(input.ownerId);
      if (!owner) throw new NotFoundError("Usuario inexistente.");
      if (owner.organizationId) throw new ConflictError("El usuario ya pertenece a una organización.");
      await r.organizations.save(org);
      owner.organizationId = org.id;
      if (!owner.roleIds.includes(this.config.adminRoleId)) owner.roleIds.push(this.config.adminRoleId);
      await r.users.save(owner);
      await r.subscriptions.save({
        id: this.ids.next("sub"),
        subject: { type: "organization", id: org.id },
        planId: this.config.defaultPlanId,
        status: "trialing",
        currentPeriodEnd: new Date(now.getTime() + 14 * 86_400_000),
        createdAt: now,
      });
    });
    await this.events.emit("organization.created", { userId: input.ownerId, organizationId: org.id }, { name: org.name }, { type: "organization", id: org.id });
    return org;
  }
}

import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { Subscription, User } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IDomainEvents,
  IIdGenerator,
  IPlanRepository,
  IRecurringCharges,
  ISubscriptionRepository,
  IUnitOfWork,
  IUserRepository,
} from "../../domain/ports";
import { billingSubjectOf } from "../access/AccessControl";

/** Cómo se le avisa a la persona (lo resuelve NotificationService: canales, silencio, plantillas). */
export type LifecycleNotify = (user: User, title: string, summary: string) => Promise<unknown>;

/**
 * CICLO DE VIDA de una suscripción: cancelar, deshacer la cancelación y vencer.
 *
 * REGLAS:
 *  - Cancelar no corta el servicio: sigue hasta el fin del período YA PAGADO y ahí no se
 *    renueva. Se le avisa al proveedor que no cobre más. Se puede deshacer antes de que venza.
 *  - En una organización cancela sólo quien administra la suscripción (`subscriptions:manage_org`).
 *  - Al vencer (cancelada, o sin renovación del proveedor), una PERSONA pasa al plan gratis: nunca
 *    queda bloqueada. Una organización queda sin plan hasta que su administración elija uno.
 */
export class SubscriptionLifecycle {
  constructor(
    private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: IPlanRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly uow: IUnitOfWork,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly opts: { freePlanId: string },
    private readonly recurring?: IRecurringCharges,
    private readonly notify?: LifecycleNotify,
  ) {}

  async cancel(input: { actorId: string }): Promise<Subscription> {
    const { actor, sub } = await this.current(input.actorId);
    const plan = await this.plans.findById(sub.planId);
    if (!plan?.price) throw new ValidationError("Tu plan es gratis: no hay nada que cancelar.");
    if (sub.cancelAtPeriodEnd) return sub;
    const canceled: Subscription = { ...sub, cancelAtPeriodEnd: true, canceledAt: this.clock.now() };
    await this.subscriptions.save(canceled);
    await this.recurring?.stop(canceled);
    await this.events.emit("subscription.canceled", { userId: actor.id, organizationId: actor.organizationId }, { planId: sub.planId, until: sub.currentPeriodEnd }, { type: "subscription", id: sub.id });
    return canceled;
  }

  async resume(input: { actorId: string }): Promise<Subscription> {
    const { actor, sub } = await this.current(input.actorId);
    if (!sub.cancelAtPeriodEnd) return sub;
    if (sub.currentPeriodEnd <= this.clock.now()) throw new ValidationError("La suscripción ya terminó: elegí un plan de nuevo.");
    const resumed: Subscription = { ...sub, cancelAtPeriodEnd: false, canceledAt: undefined };
    await this.subscriptions.save(resumed);
    await this.recurring?.resume(resumed);
    await this.events.emit("subscription.resumed", { userId: actor.id, organizationId: actor.organizationId }, { planId: sub.planId }, { type: "subscription", id: sub.id });
    return resumed;
  }

  /** Lo corre la cola todos los días: vence lo que terminó y pasa a las personas al plan gratis. */
  async expireDue(limit = 200): Promise<{ expired: number; downgraded: number }> {
    const now = this.clock.now();
    let downgraded = 0;
    const due = await this.subscriptions.findDue(now, limit);
    for (const sub of due) {
      const toFree = sub.subject.type === "user" && sub.planId !== this.opts.freePlanId;
      await this.uow.transaction(async (r) => {
        await r.subscriptions.save({ ...sub, status: "canceled", endedAt: now });
        if (toFree) {
          await r.subscriptions.save({
            id: this.ids.next("sub"), subject: sub.subject, planId: this.opts.freePlanId, status: "active",
            currentPeriodEnd: new Date(now.getTime() + 3650 * 86_400_000), createdAt: new Date(now.getTime() + 1),
          });
        }
      });
      if (toFree) downgraded++;
      const actor = sub.subject.type === "organization" ? { userId: "sistema:suscripciones", organizationId: sub.subject.id } : { userId: sub.subject.id };
      await this.events.emit("subscription.expired", actor, { planId: sub.planId, reason: sub.cancelAtPeriodEnd ? "canceled" : "not_renewed", downgradedTo: toFree ? this.opts.freePlanId : undefined }, { type: "subscription", id: sub.id });
      if (toFree && this.notify) {
        const user = await this.users.findById(sub.subject.id);
        const plan = await this.plans.findById(sub.planId);
        if (user && user.status === "active") {
          await this.notify(user, `Terminó tu plan ${plan?.name ?? ""}`.trim(), "Seguís usando Sin Humo con el plan Gratis. Cuando quieras, volvés a elegir un plan desde tu cuenta.").catch(() => undefined);
        }
      }
    }
    return { expired: due.length, downgraded };
  }

  private async current(actorId: string): Promise<{ actor: User; sub: Subscription }> {
    const actor = await this.users.findById(actorId);
    if (!actor) throw new NotFoundError("Usuario inexistente.");
    const subject = billingSubjectOf(actor);
    if (subject.type === "organization" && !(await this.authz.permissionsOf(actor)).has("subscriptions:manage_org")) {
      throw new AccessDeniedError("Sólo un administrador puede cambiar la suscripción de la organización.", "no_permission");
    }
    const sub = await this.subscriptions.findCurrent(subject);
    if (!sub || sub.status === "canceled") throw new NotFoundError("No tenés una suscripción vigente.");
    return { actor, sub };
  }
}

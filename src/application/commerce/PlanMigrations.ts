import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import { formatPrice, type Plan, type PlanMigration, type Subscription, type User } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  ICountryRegistry,
  IDomainEvents,
  IIdGenerator,
  IPlanMigrationRepository,
  IPlanRepository,
  IPlanWriter,
  IRecurringCharges,
  ISubscriptionRepository,
  IUnitOfWork,
  IUserRepository,
} from "../../domain/ports";
import { migrationNoticeDays, quote } from "../../domain/rules/pricing";

const DAY = 86_400_000;
// Tope de seguridad por plan (una mudanza con más suscriptores se parte en varias).
const MAX_SUBSCRIPTIONS = 100_000;
const dateEs = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

type Notify = (u: User, title: string, summary: string) => Promise<unknown>;

export interface PendingPlanChange {
  toPlanId: string;
  toPlanName: string;
  effectiveAt: Date;
  /** Lo que se va a cobrar desde el próximo período. */
  price: { amount: number; currency: string; interval: "month" | "year" };
  message?: string;
}

/**
 * MUDAR SUSCRIPTORES de un plan a otro (permiso `plans:manage`), con aviso previo.
 * REGLAS:
 *  - Si el plan nuevo cuesta más o quita algo, al menos 30 días de aviso (términos); si es igual
 *    o mejor, puede ser enseguida. Nunca más de un año adelante.
 *  - Mismo público (personas u organizaciones); el plan nuevo es pago y distinto del viejo.
 *  - Una sola mudanza programada por plan. Al programarla, el plan viejo sale de la venta
 *    (nadie entra sin enterarse) y se avisa a cada suscriptor: a qué plan pasa, desde cuándo,
 *    cuánto va a pagar y que puede darse de baja sin costo.
 *  - En la fecha, cada suscripción vigente pasa al plan nuevo con el mismo período ya pagado;
 *    el precio nuevo (de lista, sin cupones del plan viejo) rige desde el próximo cobro.
 *    Quien ya canceló no se muda (su plan termina igual).
 *  - Se puede cancelar mientras no se aplicó; también se avisa.
 */
export class PlanMigrations {
  constructor(
    private readonly migrations: IPlanMigrationRepository,
    private readonly plans: IPlanRepository & IPlanWriter,
    private readonly subscriptions: ISubscriptionRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly ids: IIdGenerator,
    private readonly uow: IUnitOfWork,
    private readonly countries: ICountryRegistry,
    private readonly notify: Notify,
    private readonly recurring?: IRecurringCharges,
  ) {}

  async list(actorId: string): Promise<PlanMigration[]> {
    await this.manager(actorId);
    return this.migrations.findRecent(50);
  }

  /** Aviso mínimo (en días) para pasar de un plan a otro: lo usa la pantalla antes de elegir la fecha. */
  async noticeDays(actorId: string, fromPlanId: string, toPlanId: string): Promise<number> {
    await this.manager(actorId);
    return migrationNoticeDays(await this.plan(fromPlanId), await this.plan(toPlanId));
  }

  async schedule(actorId: string, input: { fromPlanId: string; toPlanId: string; effectiveAt: Date; message?: string }): Promise<PlanMigration> {
    const actor = await this.manager(actorId);
    const from = await this.plan(input.fromPlanId);
    const to = await this.plan(input.toPlanId);
    if (from.id === to.id) throw new ValidationError("Elegí un plan distinto.");
    if (!to.price) throw new ValidationError("Se muda a un plan pago (para pasar al gratis, cada persona cancela).");
    if (from.audience !== to.audience) throw new ValidationError("Los dos planes tienen que ser para el mismo público (personas u organizaciones).");
    if ((await this.migrations.findScheduled()).some((m) => m.fromPlanId === from.id)) throw new ConflictError(`Ya hay una mudanza programada desde ${from.name}.`);
    const live = await this.movable(from.id);
    if (!live.length) throw new ConflictError(`${from.name} no tiene suscripciones para mudar.`);

    const now = this.clock.now();
    const days = migrationNoticeDays(from, to);
    if (!(input.effectiveAt instanceof Date) || Number.isNaN(input.effectiveAt.getTime())) throw new ValidationError("Falta la fecha.");
    if (input.effectiveAt.getTime() < now.getTime() + days * DAY - 60_000) {
      throw new ValidationError(days ? `El plan nuevo cuesta más o quita algo: hace falta avisar con al menos ${days} días (desde el ${dateEs(new Date(now.getTime() + days * DAY))}).` : "La fecha no puede ser anterior a hoy.");
    }
    if (input.effectiveAt.getTime() > now.getTime() + 365 * DAY) throw new ValidationError("La fecha no puede ser más de un año adelante.");
    const message = typeof input.message === "string" ? input.message.trim().slice(0, 500) || undefined : undefined;

    // Nadie entra al plan viejo sin enterarse.
    if (from.forSale !== false) await this.plans.save({ ...from, forSale: false, customized: { at: now, by: actor.id } });
    const m: PlanMigration = {
      id: this.ids.next("migration"), fromPlanId: from.id, toPlanId: to.id, status: "scheduled", announcedAt: now, effectiveAt: input.effectiveAt,
      message, createdBy: actor.id, notified: 0,
    };
    m.notified = await this.tell(live, "Cambia tu plan", (s) => this.noticeText(from, to, s, m));
    await this.migrations.save(m);
    await this.events.emit("plan.migration_scheduled", { userId: actor.id }, { from: from.id, to: to.id, effectiveAt: m.effectiveAt.toISOString(), subscriptions: live.length, notified: m.notified }, { type: "plan_migration", id: m.id });
    return m;
  }

  async cancel(actorId: string, migrationId: string): Promise<PlanMigration> {
    const actor = await this.manager(actorId);
    const m = await this.migrations.findById(migrationId);
    if (!m) throw new NotFoundError("No existe esa mudanza.");
    if (m.status !== "scheduled") throw new ConflictError("Esa mudanza ya no está programada.");
    const from = await this.plan(m.fromPlanId);
    const canceled: PlanMigration = { ...m, status: "canceled", canceled: { at: this.clock.now(), by: actor.id } };
    await this.migrations.save(canceled);
    await this.tell(await this.movable(from.id), "Tu plan no cambia", () => `Te habíamos avisado que tu plan ${from.name} iba a cambiar. Al final no cambia: seguís igual que hasta ahora.`);
    await this.events.emit("plan.migration_canceled", { userId: actor.id }, { from: m.fromPlanId, to: m.toPlanId }, { type: "plan_migration", id: m.id });
    return canceled;
  }

  /** Para "Mi cuenta": si a esta suscripción le toca una mudanza programada, a qué plan, cuándo y cuánto. */
  async pendingFor(sub: Subscription): Promise<PendingPlanChange | undefined> {
    if (sub.cancelAtPeriodEnd || !["active", "trialing", "past_due"].includes(sub.status)) return undefined;
    const m = (await this.migrations.findScheduled()).find((x) => x.fromPlanId === sub.planId);
    const to = m && (await this.plans.findById(m.toPlanId));
    if (!m || !to?.price) return undefined;
    const interval = sub.interval === "year" && (to.yearlyPrice || to.price.interval === "year") ? "year" : "month";
    const q = quote(to, interval, this.countries.get(sub.charged?.country));
    return { toPlanId: to.id, toPlanName: to.name, effectiveAt: m.effectiveAt, price: { amount: q.amount, currency: q.currency, interval }, message: m.message };
  }

  /** Lo corre la cola: aplica las mudanzas cuya fecha llegó. */
  async applyDue(): Promise<{ migrations: number; subscriptions: number }> {
    const now = this.clock.now();
    let moved = 0;
    const due = (await this.migrations.findScheduled()).filter((m) => m.effectiveAt <= now);
    for (const m of due) {
      const to = await this.plans.findById(m.toPlanId);
      if (!to?.price) continue; // (el plan nuevo dejó de existir o de ser pago: queda programada para revisar)
      let count = 0;
      for (const sub of await this.movable(m.fromPlanId)) {
        await this.move(sub, to, m, now);
        count++;
      }
      await this.migrations.save({ ...m, status: "applied", applied: { at: now, subscriptions: count } });
      await this.events.emit("plan.migration_applied", { userId: "sistema:planes" }, { from: m.fromPlanId, to: m.toPlanId, subscriptions: count }, { type: "plan_migration", id: m.id });
      moved += count;
    }
    return { migrations: due.length, subscriptions: moved };
  }

  private async move(sub: Subscription, to: Plan, m: PlanMigration, now: Date): Promise<void> {
    const interval = sub.interval === "year" && (to.yearlyPrice || to.price?.interval === "year") ? "year" : "month";
    const q = quote(to, interval, this.countries.get(sub.charged?.country));
    const next: Subscription = {
      id: this.ids.next("sub"), subject: sub.subject, planId: to.id, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, createdAt: now,
      interval, charged: { amount: q.amount, currency: q.currency, listAmount: q.listAmount, country: q.country }, migratedFrom: { planId: m.fromPlanId, migrationId: m.id },
    };
    await this.uow.transaction(async (r) => {
      await r.subscriptions.save({ ...sub, status: "replaced", endedAt: now });
      await r.subscriptions.save(next);
    });
    await this.recurring?.reprice?.(next);
  }

  /** Vigentes que se mudan: no las que ya cancelaron (terminan igual). */
  private async movable(planId: string): Promise<Subscription[]> {
    return (await this.subscriptions.findLiveByPlan(planId, MAX_SUBSCRIPTIONS)).filter((s) => !s.cancelAtPeriodEnd);
  }

  /** Avisa a quien paga cada suscripción: la persona, o quienes administran la organización. */
  private async tell(subs: Subscription[], title: string, text: (s: Subscription) => string): Promise<number> {
    let n = 0;
    for (const s of subs) {
      const people = s.subject.type === "user"
        ? [await this.users.findById(s.subject.id)]
        : await this.orgAdmins(s.subject.id);
      for (const u of people) {
        if (!u || u.status !== "active") continue;
        await this.notify(u, title, text(s)).catch(() => undefined);
        n++;
      }
    }
    return n;
  }

  private async orgAdmins(orgId: string): Promise<User[]> {
    const out: User[] = [];
    for (const u of await this.users.findByOrganization(orgId)) if ((await this.authz.permissionsOf(u)).has("subscriptions:manage_org")) out.push(u);
    return out;
  }

  private noticeText(from: Plan, to: Plan, s: Subscription, m: PlanMigration): string {
    const interval = s.interval === "year" && (to.yearlyPrice || to.price?.interval === "year") ? "year" : "month";
    const q = quote(to, interval, this.countries.get(s.charged?.country));
    const price = formatPrice({ amount: q.amount, currency: q.currency, interval });
    return [
      `Desde el ${dateEs(m.effectiveAt)}, tu plan ${from.name} pasa a ser ${to.name}.`,
      `Conservás lo que ya pagaste; desde el próximo cobro vas a pagar ${price}.`,
      m.message,
      "Si no te sirve, podés darte de baja sin costo desde tu cuenta antes de esa fecha.",
    ].filter(Boolean).join(" ");
  }

  private async plan(id: string): Promise<Plan> {
    const p = typeof id === "string" ? await this.plans.findById(id) : undefined;
    if (!p) throw new NotFoundError("No existe ese plan.");
    return p;
  }

  private async manager(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("plans:manage")) throw new AccessDeniedError("No tenés permiso para mudar suscriptores.", "no_permission");
    return u;
  }
}

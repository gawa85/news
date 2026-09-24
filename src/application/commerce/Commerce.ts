import { randomBytes } from "node:crypto";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type {
  BillingInterval,
  BillingSubject,
  BrandMark,
  Branding,
  Coupon,
  CountryConfig,
  DomainEvent,
  PriceQuote,
  ReferralUse,
  User,
} from "../../domain/model";
import { couponProblem, quote as quotePrice } from "../../domain/rules/pricing";
import type {
  IAuthorizationService,
  IBrandingRepository,
  IClock,
  ICountryRegistry,
  ICouponRepository,
  IDnsTxtResolver,
  IDomainEvents,
  IEventBus,
  IOrganizationRepository,
  IParameterStore,
  IPlanRepository,
  IReferralRepository,
  ISubscriptionRepository,
  IUserRepository,
} from "../../domain/ports";
import { billingSubjectOf, type AccessControl } from "../access/AccessControl";

const subjectKey = (s: BillingSubject) => `${s.type}:${s.id}`;
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,29}$/;

/** Países habilitados (desde la configuración). */
export class CountryRegistry implements ICountryRegistry {
  constructor(
    private readonly countries: CountryConfig[],
    private readonly defaultCode: string,
  ) {
    if (!countries.some((c) => c.code === defaultCode)) throw new Error(`Falta el país por defecto ${defaultCode}.`);
  }
  get(code?: string): CountryConfig {
    return this.countries.find((c) => c.code === (code ?? this.defaultCode)?.toUpperCase()) ?? this.countries.find((c) => c.code === this.defaultCode)!;
  }
  all(): CountryConfig[] {
    return this.countries;
  }
  has(code: string): boolean {
    return this.countries.some((c) => c.code === code.toUpperCase());
  }
}

/**
 * PRECIOS: cotiza un plan (mensual o anual) para el país del cliente, con cupón e impuestos.
 * CUPONES: los crea quien tiene `plans:manage`; al confirmarse el pago se registra el uso
 * (atómico: nunca más usos que el máximo) y se dispara la recompensa del referido.
 */
export class CommerceService {
  constructor(
    private readonly coupons: ICouponRepository,
    private readonly plans: IPlanRepository,
    private readonly subscriptions: ISubscriptionRepository,
    private readonly users: IUserRepository,
    private readonly orgs: IOrganizationRepository,
    private readonly countries: ICountryRegistry,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
  ) {}

  async countryOf(user: User): Promise<CountryConfig> {
    const org = user.organizationId ? await this.orgs.findById(user.organizationId) : undefined;
    return this.countries.get(org?.country ?? user.country);
  }

  /** País de la persona (o de su organización, si la administra). Cambia moneda, precios e impuestos. */
  async setCountry(input: { actorId: string; country: string }): Promise<CountryConfig> {
    const user = await this.users.findById(input.actorId);
    if (!user) throw new NotFoundError("Usuario inexistente.");
    if (!this.countries.has(input.country)) throw new ValidationError(`Todavía no operamos en ${input.country}. Países: ${this.countries.all().map((c) => c.name).join(", ")}.`);
    const code = input.country.toUpperCase();
    if (user.organizationId) {
      if (!(await this.authz.permissionsOf(user)).has("subscriptions:manage_org")) throw new AccessDeniedError("El país de la organización lo cambia quien administra la suscripción.", "no_permission");
      const org = await this.orgs.findById(user.organizationId);
      if (org) await this.orgs.save({ ...org, country: code });
    } else {
      await this.users.save({ ...user, country: code });
    }
    return this.countries.get(code);
  }

  /** Cotización para mostrar (y la que usa el cambio de plan). */
  async quote(input: { userId: string; planId: string; interval: BillingInterval; couponCode?: string }): Promise<PriceQuote> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new NotFoundError("Usuario inexistente.");
    const plan = await this.plans.findById(input.planId);
    if (!plan) throw new NotFoundError(`No existe el plan ${input.planId}.`);
    if (!plan.price) throw new ValidationError(`El plan ${plan.name} es gratis.`);
    const country = await this.countryOf(user);
    let coupon: Coupon | undefined;
    if (input.couponCode) {
      coupon = await this.coupons.find(input.couponCode.trim());
      if (!coupon) throw new NotFoundError("Ese cupón no existe.");
      const subject = billingSubjectOf(user);
      const price = country.planPrices?.[plan.id]?.[input.interval] ?? (input.interval === "year" ? plan.yearlyPrice : plan.price);
      const problem = couponProblem(coupon, {
        planId: plan.id, interval: input.interval, currency: price?.currency ?? country.currency, now: this.clock.now(),
        subjectKey: subjectKey(subject), hasPaidBefore: await this.hasPaid(subject),
        alreadyRedeemed: !!(await this.coupons.findRedemption(coupon.code, subjectKey(subject))),
      });
      if (problem) throw new ValidationError(problem);
    }
    try {
      return quotePrice(plan, input.interval, country, coupon);
    } catch (e) {
      throw new ValidationError(e instanceof Error ? e.message : String(e));
    }
  }

  async createCoupon(input: { actorId: string } & Partial<Coupon> & { code: string; kind: Coupon["kind"]; value: number; description: string }): Promise<Coupon> {
    const actor = await this.users.findById(input.actorId);
    if (!actor || !(await this.authz.permissionsOf(actor)).has("plans:manage")) throw new AccessDeniedError("No tenés permiso para crear cupones.", "no_permission");
    const code = input.code.trim().toUpperCase();
    if (!CODE_RE.test(code)) throw new ValidationError("El código: 3 a 30 letras, números o guiones.");
    if (await this.coupons.find(code)) throw new ConflictError(`Ya existe el cupón ${code}.`);
    const c = this.build({ ...input, code, source: "manual", createdBy: actor.id });
    await this.coupons.save(c);
    await this.events.emit("coupon.created", { userId: actor.id }, { code, kind: c.kind, value: c.value, maxRedemptions: c.maxRedemptions });
    return c;
  }

  async deactivateCoupon(input: { actorId: string; code: string }): Promise<void> {
    const actor = await this.users.findById(input.actorId);
    if (!actor || !(await this.authz.permissionsOf(actor)).has("plans:manage")) throw new AccessDeniedError("No tenés permiso para gestionar cupones.", "no_permission");
    const c = await this.coupons.find(input.code);
    if (!c) throw new NotFoundError("Ese cupón no existe.");
    await this.coupons.save({ ...c, active: false });
  }

  /** Cupón creado por el sistema (bienvenida o premio de un referido). */
  async issuePersonalCoupon(input: { prefix: string; subject: BillingSubject; percent: number; description: string; source: Coupon["source"]; validDays: number; newCustomersOnly: boolean }): Promise<Coupon> {
    for (let i = 0; i < 5; i++) {
      const code = `${input.prefix}-${randomBytes(3).toString("hex").toUpperCase()}`;
      if (await this.coupons.find(code)) continue;
      const c = this.build({
        code, kind: "percent", value: input.percent, description: input.description, durationCycles: 1, maxRedemptions: 1,
        newCustomersOnly: input.newCustomersOnly, restrictedTo: input.subject, source: input.source, createdBy: "sistema",
        validTo: new Date(this.clock.now().getTime() + input.validDays * 86_400_000),
      });
      await this.coupons.save(c);
      return c;
    }
    throw new ConflictError("No se pudo generar un código de cupón.");
  }

  /** Al confirmarse un pago: registrar el uso del cupón. */
  attach(bus: IEventBus): void {
    bus.subscribe(async (e: DomainEvent) => {
      if (e.type !== "payment.confirmed" || !e.target) return;
      const sub = await this.subscriptions.findById(e.target.id);
      const code = sub?.charged?.couponCode;
      if (!sub || !code) return;
      const key = subjectKey(sub.subject);
      if (await this.coupons.findRedemption(code, key)) return; // idempotente
      await this.coupons.incrementRedemptions(code); // si ya estaba agotado, igual se respeta lo que pagó
      await this.coupons.addRedemption({ id: `${code}|${key}`, code, subject: sub.subject, subscriptionId: sub.id, discount: (sub.charged!.listAmount ?? 0) - sub.charged!.amount, at: this.clock.now() });
    });
  }

  async hasPaid(subject: BillingSubject): Promise<boolean> {
    const paid = new Set((await this.plans.findAll()).filter((p) => p.price).map((p) => p.id));
    return (await this.subscriptions.findAll()).some((s) => subjectKey(s.subject) === subjectKey(subject) && s.status !== "pending_payment" && s.status !== "trialing" && paid.has(s.planId));
  }

  private build(c: Partial<Coupon> & Pick<Coupon, "code" | "kind" | "value" | "description" | "source" | "createdBy">): Coupon {
    if (c.kind === "percent" && (c.value <= 0 || c.value > 100)) throw new ValidationError("El porcentaje va de 1 a 100.");
    if (c.kind === "fixed" && (c.value <= 0 || !c.currency)) throw new ValidationError("Un descuento fijo necesita monto y moneda.");
    if (c.validFrom && c.validTo && c.validTo <= c.validFrom) throw new ValidationError("La fecha de fin es anterior a la de inicio.");
    return {
      code: c.code, description: c.description, kind: c.kind, value: c.value, currency: c.currency, planIds: c.planIds ?? [],
      intervals: c.intervals?.length ? c.intervals : ["month", "year"], durationCycles: c.durationCycles === undefined ? 1 : c.durationCycles,
      maxRedemptions: c.maxRedemptions ?? null, redemptions: 0, newCustomersOnly: c.newCustomersOnly ?? false, restrictedTo: c.restrictedTo,
      validFrom: c.validFrom, validTo: c.validTo, active: true, source: c.source, createdBy: c.createdBy, createdAt: this.clock.now(),
    };
  }
}

/**
 * REFERIDOS: cada persona tiene un código para invitar.
 * REGLAS:
 *  - Se aplica dentro de los primeros días desde el alta (parámetro), una sola vez,
 *    y nunca el propio ni el de alguien de la misma organización.
 *  - Quien llega recibe un cupón de bienvenida personal (sólo para su primer pago).
 *  - Quien invitó recibe un cupón de un mes gratis RECIÉN cuando el invitado paga,
 *    con tope anual de premios (parámetro). Todo queda en la auditoría.
 */
export class ReferralService {
  constructor(
    private readonly repo: IReferralRepository,
    private readonly commerce: CommerceService,
    private readonly users: IUserRepository,
    private readonly subscriptions: ISubscriptionRepository,
    private readonly params: IParameterStore,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly notify?: (user: User, title: string, summary: string) => Promise<unknown>,
  ) {}

  async myCode(userId: string): Promise<string> {
    const existing = await this.repo.findCodeByOwner(userId);
    if (existing) return existing.code;
    const u = await this.users.findById(userId);
    if (!u) throw new NotFoundError("Usuario inexistente.");
    const base = u.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5) || "AMIGO";
    for (let i = 0; i < 10; i++) {
      const code = `${base}-${randomBytes(2).toString("hex").toUpperCase()}`;
      try {
        await this.repo.insertCode({ code, ownerId: userId, createdAt: this.clock.now() });
        return code;
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    throw new ConflictError("No se pudo generar el código.");
  }

  async apply(input: { userId: string; code: string }): Promise<{ welcomeCoupon: string; percent: number }> {
    const user = await this.users.findById(input.userId);
    if (!user || user.status !== "active") throw new NotFoundError("Usuario inexistente.");
    const windowDays = await this.params.number("referrals.window_days");
    if (this.clock.now().getTime() - user.createdAt.getTime() > windowDays * 86_400_000) throw new ValidationError(`El código de invitación se usa en los primeros ${windowDays} días.`);
    if (await this.repo.findUse(user.id)) throw new ConflictError("Ya usaste un código de invitación.");
    const ref = await this.repo.findCode(input.code.trim());
    if (!ref) throw new NotFoundError("Ese código de invitación no existe.");
    const referrer = await this.users.findById(ref.ownerId);
    if (!referrer || referrer.status !== "active") throw new ValidationError("Ese código ya no está vigente.");
    if (referrer.id === user.id) throw new ValidationError("No podés usar tu propio código.");
    if (user.organizationId && user.organizationId === referrer.organizationId) throw new ValidationError("No vale entre miembros de la misma organización.");
    if (await this.commerce.hasPaid(billingSubjectOf(user))) throw new ValidationError("El código es para quien todavía no contrató.");

    const percent = await this.params.number("referrals.welcome_percent");
    const coupon = await this.commerce.issuePersonalCoupon({
      prefix: "BIENVENIDA", subject: billingSubjectOf(user), percent, description: `Bienvenida por invitación de ${referrer.name}`,
      source: "referral_welcome", validDays: 60, newCustomersOnly: true,
    });
    const use: ReferralUse = { id: user.id, code: ref.code, referrerId: referrer.id, referredUserId: user.id, at: this.clock.now(), status: "pending", welcomeCoupon: coupon.code };
    await this.repo.saveUse(use);
    return { welcomeCoupon: coupon.code, percent };
  }

  async summary(userId: string) {
    const uses = await this.repo.findUsesByReferrer(userId);
    return { code: await this.myCode(userId), invited: uses.length, rewarded: uses.filter((u) => u.status === "rewarded").length, pending: uses.filter((u) => u.status === "pending").length };
  }

  /** Premio cuando el invitado paga por primera vez. */
  attach(bus: IEventBus): void {
    bus.subscribe(async (e: DomainEvent) => {
      if (e.type !== "payment.confirmed" || !e.target) return;
      const sub = await this.subscriptions.findById(e.target.id);
      if (!sub || sub.subject.type !== "user" || (sub.charged && sub.charged.amount <= 0)) return;
      const use = await this.repo.findUse(sub.subject.id);
      if (!use || use.status !== "pending") return;
      const referrer = await this.users.findById(use.referrerId);
      if (!referrer || referrer.status !== "active") return void (await this.repo.saveUse({ ...use, status: "rejected", reason: "quien invitó ya no está activo" }));
      const max = await this.params.number("referrals.max_rewards_per_year");
      const yearAgo = this.clock.now().getTime() - 365 * 86_400_000;
      const recent = (await this.repo.findUsesByReferrer(referrer.id)).filter((u) => u.status === "rewarded" && u.at.getTime() >= yearAgo).length;
      if (recent >= max) return void (await this.repo.saveUse({ ...use, status: "rejected", reason: `tope de ${max} premios por año` }));
      const reward = await this.commerce.issuePersonalCoupon({
        prefix: "GRACIAS", subject: billingSubjectOf(referrer), percent: 100, description: "Un mes gratis por invitar",
        source: "referral_reward", validDays: 365, newCustomersOnly: false,
      });
      await this.repo.saveUse({ ...use, status: "rewarded", rewardCoupon: reward.code });
      await this.events.emit("referral.rewarded", { userId: referrer.id, organizationId: referrer.organizationId }, { coupon: reward.code }, { type: "user", id: use.referredUserId });
      await this.notify?.(referrer, "¡Ganaste un mes gratis!", `Alguien que invitaste se suscribió. Tu cupón: ${reward.code} (vale un año).`);
    });
  }
}

/**
 * MARCA BLANCA: logo, color, nombre del remitente, pie y dominio propio verificado.
 * REGLAS: `users:manage_org` y plan con `white_label`. El dominio se verifica con un TXT
 * (`_sinhumo.<dominio>` = `sinhumo-verify=<token>`) y no puede estar tomado por otra organización.
 */
export class BrandingService {
  constructor(
    private readonly repo: IBrandingRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly dns: IDnsTxtResolver,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly platformDomains: string[],
  ) {}

  async update(input: { actorId: string; displayName?: string; logoUrl?: string | null; primaryColor?: string | null; footer?: string | null; emailFromName?: string | null; hidePoweredBy?: boolean }): Promise<Branding> {
    const { actor, current } = await this.admin(input.actorId);
    const next: Branding = { ...(current ?? { organizationId: actor.organizationId!, displayName: "", hidePoweredBy: false }), updatedAt: this.clock.now(), updatedBy: actor.id };
    if (input.displayName !== undefined) next.displayName = input.displayName.trim().slice(0, 60);
    if (!next.displayName) throw new ValidationError("Falta el nombre que se muestra.");
    if (input.logoUrl !== undefined) {
      if (input.logoUrl && !/^https:\/\/\S+\.(png|svg|jpg|jpeg|webp)(\?\S*)?$/i.test(input.logoUrl)) throw new ValidationError("El logo tiene que ser un link https a una imagen (png, svg, jpg o webp).");
      next.logoUrl = input.logoUrl ?? undefined;
    }
    if (input.primaryColor !== undefined) {
      if (input.primaryColor && !/^#[0-9a-f]{6}$/i.test(input.primaryColor)) throw new ValidationError("El color va como #RRGGBB.");
      if (input.primaryColor && contrastWithWhite(input.primaryColor) < 4.5) throw new ValidationError("Ese color no tiene contraste suficiente con texto blanco (accesibilidad: mínimo 4,5:1).");
      next.primaryColor = input.primaryColor ?? undefined;
    }
    if (input.footer !== undefined) next.footer = input.footer?.trim().slice(0, 200) || undefined;
    if (input.emailFromName !== undefined) next.emailFromName = input.emailFromName?.replace(/[<>"\r\n]/g, "").trim().slice(0, 60) || undefined;
    if (input.hidePoweredBy !== undefined) next.hidePoweredBy = input.hidePoweredBy;
    await this.repo.save(next);
    await this.events.emit("branding.updated", { userId: actor.id, organizationId: actor.organizationId }, { hidePoweredBy: next.hidePoweredBy });
    return next;
  }

  async setDomain(input: { actorId: string; domain: string }): Promise<{ domain: string; txtName: string; txtValue: string }> {
    const { actor, current } = await this.admin(input.actorId);
    const domain = input.domain.trim().toLowerCase().replace(/\.$/, "");
    if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) throw new ValidationError("Dominio inválido.");
    if (this.platformDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) throw new ValidationError("Ese dominio es de la plataforma.");
    const taken = await this.repo.findByDomain(domain);
    if (taken && taken.organizationId !== actor.organizationId) throw new ConflictError("Ese dominio ya lo usa otra organización.");
    if (!current) throw new ValidationError("Primero cargá el nombre y la marca.");
    const token = randomBytes(16).toString("hex");
    await this.repo.save({ ...current, customDomain: domain, domainToken: token, domainVerifiedAt: undefined, updatedAt: this.clock.now(), updatedBy: actor.id });
    return { domain, txtName: `_sinhumo.${domain}`, txtValue: `sinhumo-verify=${token}` };
  }

  async verifyDomain(actorId: string): Promise<Branding> {
    const { actor, current } = await this.admin(actorId);
    if (!current?.customDomain || !current.domainToken) throw new ValidationError("Primero indicá el dominio.");
    let records: string[] = [];
    try {
      records = await this.dns.resolveTxt(`_sinhumo.${current.customDomain}`);
    } catch {
      records = [];
    }
    if (!records.some((r) => r.trim() === `sinhumo-verify=${current.domainToken}`)) {
      throw new ValidationError(`No encontramos el registro TXT en _sinhumo.${current.customDomain}. Los cambios de DNS pueden tardar unas horas.`);
    }
    const verified = { ...current, domainVerifiedAt: this.clock.now(), updatedAt: this.clock.now(), updatedBy: actor.id };
    await this.repo.save(verified);
    await this.events.emit("branding.domain_verified", { userId: actor.id, organizationId: actor.organizationId }, { domain: current.customDomain });
    return verified;
  }

  /** Marca para los mensajes de un miembro (si su organización tiene marca blanca activa). */
  async markFor(user: User): Promise<BrandMark | undefined> {
    if (!user.organizationId) return undefined;
    const b = await this.repo.find(user.organizationId);
    if (!b) return undefined;
    const { plan } = await this.access.planOf(user);
    if (!plan.features.includes("white_label")) return undefined; // si baja de plan, vuelve la marca Sin Humo
    return { name: b.displayName, color: b.primaryColor, logoUrl: b.logoUrl, poweredBy: !b.hidePoweredBy, footer: b.footer, emailFromName: b.emailFromName };
  }

  /** Para el sitio con dominio propio: sólo si está verificado. */
  async byHost(host: string): Promise<Pick<Branding, "displayName" | "logoUrl" | "primaryColor" | "footer" | "hidePoweredBy"> | undefined> {
    const b = await this.repo.findByDomain(host.split(":")[0]!.toLowerCase());
    if (!b?.domainVerifiedAt) return undefined;
    return { displayName: b.displayName, logoUrl: b.logoUrl, primaryColor: b.primaryColor, footer: b.footer, hidePoweredBy: b.hidePoweredBy };
  }

  private async admin(actorId: string): Promise<{ actor: User; current?: Branding }> {
    const actor = await this.users.findById(actorId);
    if (!actor?.organizationId) throw new ValidationError("La marca blanca es para organizaciones.");
    if (!(await this.authz.permissionsOf(actor)).has("users:manage_org")) throw new AccessDeniedError("Sólo quien administra la organización cambia la marca.", "no_permission");
    const { plan } = await this.access.planOf(actor);
    if (!plan.features.includes("white_label")) throw new AccessDeniedError(`La marca blanca no está incluida en el plan ${plan.name}.`, "feature_not_in_plan");
    return { actor, current: await this.repo.find(actor.organizationId) };
  }
}

/** Contraste WCAG de un color con texto blanco. */
export function contrastWithWhite(hex: string): number {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  return 1.05 / (L + 0.05);
}

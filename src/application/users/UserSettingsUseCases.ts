import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import {
  isValidUrlPattern,
  withinLimit,
  type AlertRule,
  type AlertTrigger,
  type ChannelType,
  type SavedRuleSet,
  type UrlRules,
  type User,
} from "../../domain/model";
import type {
  IAlertRuleRepository,
  IAuthorizationService,
  IChannelLinkCodes,
  IClock,
  IDomainEvents,
  IIdGenerator,
  IRuleSetRepository,
  IUnitOfWork,
  IUserRepository,
  IVerificationCodeService,
} from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";
import { billingSubjectOf } from "../access/AccessControl";
import type { NotificationService } from "../messaging/NotificationService";

/**
 * Guardar reglas de URL (personales o de la organización).
 * REGLAS: permiso `rules:own`/`rules:org` (rol) + funcionalidad `url_rules`/`org_rules` (plan)
 * + límite de conjuntos guardados + patrones válidos.
 */
export class SaveRuleSetUseCase {
  constructor(
    private readonly ruleSets: IRuleSetRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly events: IDomainEvents,
  ) {}

  async execute(input: { actorId: string; scope: "user" | "organization"; name: string; urlRules: UrlRules }): Promise<SavedRuleSet> {
    const actor = await this.access.userOrThrow(input.actorId);
    const perms = await this.authz.permissionsOf(actor);
    const { plan } = await this.access.planOf(actor);

    const orgScope = input.scope === "organization";
    if (orgScope && !actor.organizationId) throw new ValidationError("No pertenecés a una organización.");
    if (!perms.has(orgScope ? "rules:org" : "rules:own")) throw new AccessDeniedError("Tu rol no permite guardar estas reglas.", "no_permission");
    const feature = orgScope ? "org_rules" : "url_rules";
    if (!plan.features.includes(feature)) throw new AccessDeniedError(`Las reglas ${orgScope ? "de organización" : "guardadas"} no están en el plan ${plan.name}.`, "feature_not_in_plan");

    const patterns = [...(input.urlRules.include ?? []), ...(input.urlRules.onlyFrom ?? []), ...(input.urlRules.exclude ?? [])];
    const invalid = patterns.filter((p) => !isValidUrlPattern(p));
    if (invalid.length) throw new ValidationError(`Patrones inválidos: ${invalid.join(", ")}`);

    const owner = orgScope ? billingSubjectOf(actor) : { type: "user" as const, id: actor.id };
    const count = await this.ruleSets.countFor(owner);
    if (!withinLimit(plan.limits.maxSavedRuleSets, count + 1)) {
      throw new AccessDeniedError(`Tu plan permite ${plan.limits.maxSavedRuleSets} conjunto(s) de reglas.`, "limit_exceeded");
    }

    const set: SavedRuleSet = { id: this.ids.next("rules"), owner, name: input.name, urlRules: input.urlRules, active: true, createdAt: this.clock.now() };
    await this.ruleSets.save(set);
    await this.events.emit("rules.saved", { userId: actor.id, organizationId: actor.organizationId }, { scope: input.scope, exclude: input.urlRules.exclude ?? [] }, { type: "rule_set", id: set.id });
    return set;
  }
}

/**
 * Crear una alerta. REGLAS: permiso `alerts:own`, funcionalidad `alerts`, límite
 * de alertas del plan, y el canal elegido debe estar verificado y habilitado en el plan.
 */
export class CreateAlertUseCase {
  constructor(
    private readonly alerts: IAlertRuleRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
  ) {}

  async execute(input: { actorId: string; topic: string; trigger: AlertTrigger; channel: ChannelType; outletId?: string }): Promise<AlertRule> {
    const actor = await this.access.userOrThrow(input.actorId);
    const perms = await this.authz.permissionsOf(actor);
    const { plan } = await this.access.planOf(actor);
    if (!perms.has("alerts:own")) throw new AccessDeniedError("Tu rol no permite crear alertas.", "no_permission");
    if (!plan.features.includes("alerts")) throw new AccessDeniedError(`Las alertas no están en el plan ${plan.name}.`, "feature_not_in_plan");
    if (!plan.channels.includes(input.channel)) throw new AccessDeniedError(`El canal ${input.channel} no está en tu plan.`, "channel_not_in_plan");
    if (input.trigger === "credibility_change") {
      if (!input.outletId) throw new ValidationError("Indicá qué medio querés seguir.");
      if (!plan.features.includes("credibility_meter")) throw new AccessDeniedError(`El medidor de credibilidad no está en el plan ${plan.name}.`, "feature_not_in_plan");
    }
    if (!actor.channels.some((c) => c.channel === input.channel && c.verified)) {
      throw new ValidationError(`Primero verificá tu ${input.channel}.`);
    }
    const count = await this.alerts.countActiveByUser(actor.id);
    if (!withinLimit(plan.limits.maxAlerts, count + 1)) {
      throw new AccessDeniedError(`Tu plan permite ${plan.limits.maxAlerts} alertas activas.`, "limit_exceeded");
    }
    const rule: AlertRule = { id: this.ids.next("alert"), userId: actor.id, topic: input.topic, trigger: input.trigger, channel: input.channel, outletId: input.outletId, active: true, createdAt: this.clock.now() };
    await this.alerts.save(rule);
    return rule;
  }
}

/**
 * Vincular un canal nuevo (mail, WhatsApp, Telegram) a una cuenta existente.
 * 1) start: se manda un código POR ESE CANAL a esa dirección.
 * 2) confirm: si el código coincide, la dirección queda verificada y es de este usuario.
 */
export class LinkChannelUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly codes: IVerificationCodeService,
    private readonly notifications: NotificationService,
    private readonly uow: IUnitOfWork,
    private readonly clock: IClock,
    /** Vincular desde el chat con un código que muestra la web. */
    private readonly chatLink?: { codes: IChannelLinkCodes; events: IDomainEvents; whatsappNumber?: string; telegramBot?: string },
  ) {}

  /**
   * La web pide un código y la persona lo manda desde su WhatsApp o Telegram (el botón abre el chat
   * con el mensaje ya escrito). Así se prueba que el número o la cuenta es suya.
   */
  async webCode(userId: string): Promise<{ code: string; expiresAt: Date; whatsappUrl?: string; telegramUrl?: string }> {
    if (!this.chatLink) throw new NotFoundError("La vinculación desde el chat no está configurada.");
    const user = await this.users.findById(userId);
    if (!user || user.status !== "active") throw new NotFoundError("Usuario inexistente.");
    const { code, expiresAt } = await this.chatLink.codes.create(user.id);
    const wa = this.chatLink.whatsappNumber?.replace(/\D/g, "");
    return {
      code, expiresAt,
      whatsappUrl: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(`VINCULAR ${code}`)}` : undefined,
      telegramUrl: this.chatLink.telegramBot ? `https://t.me/${encodeURIComponent(this.chatLink.telegramBot.replace(/^@/, ""))}?start=${code}` : undefined,
    };
  }

  /** Llegó "VINCULAR <código>" (o "/start <código>" en Telegram) desde un chat. */
  async linkFromChat(input: { channel: ChannelType; address: string; code: string }): Promise<{ ok: true; user: User; already: boolean } | { ok: false; reason: "invalid" | "throttled" | "taken" }> {
    if (!this.chatLink) return { ok: false, reason: "invalid" };
    const r = await this.chatLink.codes.consume(input.code, `${input.channel}:${input.address}`);
    if ("error" in r) return { ok: false, reason: r.error };
    const owner = await this.users.findByChannel(input.channel, input.address);
    if (owner && owner.id !== r.userId) return { ok: false, reason: "taken" };
    if (owner) return { ok: true, user: owner, already: true };
    const user = await this.uow.transaction(async (repos) => {
      const u = await repos.users.findById(r.userId);
      if (!u) throw new NotFoundError("Usuario inexistente.");
      await repos.users.claimChannel(u.id, input.channel, input.address);
      u.channels = [...u.channels.filter((c) => !(c.channel === input.channel && c.address === input.address)), { channel: input.channel, address: input.address, verified: true, linkedAt: this.clock.now() }];
      await repos.users.save(u);
      return u;
    });
    await this.chatLink.events.emit("channel.linked", { userId: user.id, organizationId: user.organizationId }, { channel: input.channel }, { type: "user", id: user.id });
    // Por las dudas: si no fue la persona, se entera por mail.
    const name = input.channel === "whatsapp" ? "WhatsApp" : input.channel === "telegram" ? "Telegram" : input.channel;
    await this.notifications
      .notifyUser(user, { kind: "info", title: `Vinculaste ${name}`, summary: `Tu cuenta de Sin Humo ahora también responde por ${name} (${input.address}). Si no fuiste vos, escribinos desde Ayuda.`, sections: [], links: [] }, ["email"])
      .catch(() => undefined);
    return { ok: true, user, already: false };
  }

  async start(input: { userId: string; channel: ChannelType; address: string }): Promise<void> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new NotFoundError("Usuario inexistente.");
    const owner = await this.users.findByChannel(input.channel, input.address);
    if (owner && owner.id !== user.id) throw new ValidationError("Esa dirección ya está vinculada a otra cuenta.");
    const code = await this.codes.issue(user.id, input.channel, input.address);
    await this.notifications.sendTo(input.channel, input.address, {
      kind: "info",
      title: "Código de verificación",
      summary: `Tu código es ${code}. Vence en 10 minutos. Si no lo pediste, ignorá este mensaje.`,
      sections: [],
      links: [],
    }, "verification");
  }

  async confirm(input: { userId: string; channel: ChannelType; address: string; code: string }): Promise<User> {
    const ok = await this.codes.verify(input.userId, input.channel, input.address, input.code);
    if (!ok) throw new ValidationError("Código incorrecto o vencido.");
    return this.uow.transaction(async (r) => {
      const user = await r.users.findById(input.userId);
      if (!user) throw new NotFoundError("Usuario inexistente.");
      await r.users.claimChannel(user.id, input.channel, input.address);
      user.channels = [
        ...user.channels.filter((c) => !(c.channel === input.channel && c.address === input.address)),
        { channel: input.channel, address: input.address, verified: true, linkedAt: this.clock.now() },
      ];
      await r.users.save(user);
      return user;
    });
  }
}

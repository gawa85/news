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
  ) {}

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

import { AccessDeniedError, NotFoundError } from "../../domain/errors";
import type { SavedRuleSet } from "../../domain/model";
import type { IAuthorizationService, IRuleSetRepository } from "../../domain/ports";
import { billingSubjectOf, type AccessControl } from "../access/AccessControl";

/**
 * MIS REGLAS DE FUENTES: las personales y las de la organización (que se aplican a todo el equipo).
 * Las de la organización las ve cualquiera del equipo; las cambia quien tiene `rules:org`.
 * (Guardar es SaveRuleSetUseCase: ahí están el permiso, el plan, el límite y la validación.)
 */
export class RuleSetSettings {
  constructor(
    private readonly ruleSets: IRuleSetRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
  ) {}

  async list(actorId: string) {
    const actor = await this.access.userOrThrow(actorId);
    const perms = await this.authz.permissionsOf(actor);
    const { plan } = await this.access.planOf(actor);
    const active = (xs: SavedRuleSet[]) => xs.filter((s) => s.active).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const personal = active(await this.ruleSets.findByOwner({ type: "user", id: actor.id }));
    const organization = actor.organizationId ? active(await this.ruleSets.findByOwner(billingSubjectOf(actor))) : [];
    return {
      personal,
      organization,
      canEditPersonal: perms.has("rules:own") && plan.features.includes("url_rules"),
      canEditOrganization: !!actor.organizationId && perms.has("rules:org") && plan.features.includes("org_rules"),
      limit: plan.limits.maxSavedRuleSets,
    };
  }

  async deactivate(input: { actorId: string; ruleSetId: string }): Promise<void> {
    const actor = await this.access.userOrThrow(input.actorId);
    const org = actor.organizationId ? billingSubjectOf(actor) : undefined;
    const mine = (await this.ruleSets.findByOwner({ type: "user", id: actor.id })).find((s) => s.id === input.ruleSetId);
    const ours = !mine && org ? (await this.ruleSets.findByOwner(org)).find((s) => s.id === input.ruleSetId) : undefined;
    const set = mine ?? ours;
    if (!set || !set.active) throw new NotFoundError("No existe ese conjunto de reglas.");
    if (ours && !(await this.authz.permissionsOf(actor)).has("rules:org")) throw new AccessDeniedError("Las reglas de la organización las cambia quien la administra.", "no_permission");
    await this.ruleSets.save({ ...set, active: false });
  }
}

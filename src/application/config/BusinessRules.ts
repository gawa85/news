import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import {
  slugify,
  type DeclarativeRule,
  type ParameterDefinition,
  type ParameterValue,
  type RuleCondition,
  type RuleEffect,
  type RuleScenario,
  type RuleScope,
  type User,
} from "../../domain/model";
import { simulate, validateRule } from "../../domain/rules/declarativeRules";
import type {
  IAuthorizationService,
  IBusinessRuleRepository,
  IClock,
  IDeclarativeRuleSource,
  IDomainEvents,
  IParameterStore,
  IUserRepository,
} from "../../domain/ports";

/**
 * REGLAS DE NEGOCIO CONFIGURABLES: ciclo de vida
 *   borrador → prueba con escenarios → aprobación (otra persona) → activa → archivada.
 * REGLAS:
 *  - Plataforma: permiso `rules:business`; aprueba OTRA persona (cuatro ojos).
 *  - Organización: permiso `rules:org` y sólo para la propia; sólo bloquear o limitar.
 *  - Sin una prueba exitosa no se activa. Editar una regla activa crea una versión nueva (borrador);
 *    la vieja sigue vigente hasta que la nueva se aprueba. Todo queda en la auditoría.
 */
export class BusinessRulesService {
  constructor(
    private readonly repo: IBusinessRuleRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly onChange: () => void = () => {},
  ) {}

  async list(actorId: string): Promise<DeclarativeRule[]> {
    const actor = await this.user(actorId);
    const perms = await this.authz.permissionsOf(actor);
    return (await this.repo.findLatest()).filter((r) =>
      r.scope.type === "platform" ? perms.has("rules:business") : perms.has("rules:org") && r.scope.id === actor.organizationId,
    );
  }

  async history(actorId: string, ruleId: string): Promise<DeclarativeRule[]> {
    const versions = await this.repo.findVersions(ruleId);
    if (!versions.length) throw new NotFoundError("No existe esa regla.");
    await this.canManage(await this.user(actorId), versions[0]!.scope);
    return versions;
  }

  async saveDraft(input: {
    actorId: string; id?: string; name: string; description?: string; scope: RuleScope; priority?: number;
    conditions: RuleCondition[]; effect: RuleEffect; validFrom?: Date; validTo?: Date;
  }): Promise<DeclarativeRule> {
    const actor = await this.user(input.actorId);
    await this.canManage(actor, input.scope);
    const draft = { name: input.name, scope: input.scope, priority: input.priority ?? 100, conditions: input.conditions, effect: input.effect, validFrom: input.validFrom, validTo: input.validTo };
    const errors = validateRule(draft);
    if (input.scope.type === "organization" && input.effect.type === "grant_feature") errors.push("Una organización no puede regalar funcionalidades.");
    if (errors.length) throw new ValidationError(errors.join(" "));

    const id = input.id ?? `${input.scope.type === "organization" ? `${input.scope.id}-` : ""}${slugify(input.name)}`;
    const versions = await this.repo.findVersions(id);
    const latest = versions.at(-1);
    if (!input.id && latest) throw new ConflictError(`Ya existe la regla "${latest.name}". Para cambiarla, editala.`);
    if (latest && JSON.stringify(latest.scope) !== JSON.stringify(input.scope)) throw new ValidationError("No se puede cambiar el alcance de una regla existente.");
    // Si la última versión ya es un borrador, se reemplaza; si no, versión nueva.
    const version = latest?.status === "draft" ? latest.version : (latest?.version ?? 0) + 1;
    const rule: DeclarativeRule = { id, version, ...draft, description: input.description, status: "draft", createdBy: actor.id, createdAt: this.clock.now() };
    await this.repo.save(rule);
    await this.events.emit("business_rule.changed", { userId: actor.id, organizationId: actor.organizationId }, { rule: id, version, status: "draft" }, { type: "business_rule", id });
    return rule;
  }

  /** Prueba el borrador con escenarios y guarda el resultado (hace falta para aprobar). */
  async test(input: { actorId: string; ruleId: string; scenarios: RuleScenario[] }): Promise<NonNullable<DeclarativeRule["lastTest"]>> {
    const actor = await this.user(input.actorId);
    const draft = await this.latestDraft(input.ruleId);
    await this.canManage(actor, draft.scope);
    if (!input.scenarios.length) throw new ValidationError("Agregá al menos un escenario (uno que deba cumplir la regla y otro que no).");
    const results = simulate(draft, input.scenarios, this.clock.now());
    const lastTest = { at: this.clock.now(), passed: results.every((r) => r.ok), results };
    await this.repo.save({ ...draft, lastTest });
    return lastTest;
  }

  async approve(input: { actorId: string; ruleId: string }): Promise<DeclarativeRule> {
    const actor = await this.user(input.actorId);
    const draft = await this.latestDraft(input.ruleId);
    await this.canManage(actor, draft.scope);
    if (draft.scope.type === "platform" && draft.createdBy === actor.id) throw new AccessDeniedError("Una regla de la plataforma la aprueba otra persona.", "no_permission");
    if (!draft.lastTest?.passed) throw new ValidationError("Probá la regla con escenarios (y que pasen) antes de activarla.");
    for (const v of await this.repo.findVersions(draft.id)) if (v.status === "active") await this.repo.save({ ...v, status: "archived" });
    const active: DeclarativeRule = { ...draft, status: "active", approvedBy: actor.id, approvedAt: this.clock.now() };
    await this.repo.save(active);
    this.onChange();
    await this.events.emit("business_rule.changed", { userId: actor.id, organizationId: actor.organizationId }, { rule: draft.id, version: draft.version, status: "active" }, { type: "business_rule", id: draft.id });
    return active;
  }

  async archive(input: { actorId: string; ruleId: string }): Promise<void> {
    const actor = await this.user(input.actorId);
    const versions = await this.repo.findVersions(input.ruleId);
    if (!versions.length) throw new NotFoundError("No existe esa regla.");
    await this.canManage(actor, versions[0]!.scope);
    for (const v of versions) if (v.status !== "archived") await this.repo.save({ ...v, status: "archived" });
    this.onChange();
    await this.events.emit("business_rule.changed", { userId: actor.id, organizationId: actor.organizationId }, { rule: input.ruleId, status: "archived" }, { type: "business_rule", id: input.ruleId });
  }

  private async latestDraft(ruleId: string): Promise<DeclarativeRule> {
    const latest = (await this.repo.findVersions(ruleId)).at(-1);
    if (!latest) throw new NotFoundError("No existe esa regla.");
    if (latest.status !== "draft") throw new ConflictError("No hay un borrador pendiente para esa regla.");
    return latest;
  }

  private async canManage(actor: User, scope: RuleScope): Promise<void> {
    const perms = await this.authz.permissionsOf(actor);
    if (scope.type === "platform" ? !perms.has("rules:business") : !perms.has("rules:org") || actor.organizationId !== scope.id) {
      throw new AccessDeniedError("No tenés permiso para gestionar esas reglas.", "no_permission");
    }
  }

  private async user(id: string): Promise<User> {
    const u = await this.users.findById(id);
    if (!u || u.status !== "active") throw new NotFoundError("Usuario inexistente.");
    return u;
  }
}

/** Reglas vigentes con caché corta (se invalida al aprobar o archivar). */
export class CachedRuleSource implements IDeclarativeRuleSource {
  private cache?: { at: number; rules: DeclarativeRule[] };

  constructor(
    private readonly repo: IBusinessRuleRepository,
    private readonly clock: IClock,
    private readonly ttlMs = 30_000,
  ) {}

  invalidate(): void {
    this.cache = undefined;
  }

  async rulesFor(organizationId?: string): Promise<DeclarativeRule[]> {
    const now = this.clock.now().getTime();
    if (!this.cache || now - this.cache.at >= this.ttlMs) this.cache = { at: now, rules: await this.repo.findActive() };
    return this.cache.rules.filter((r) => r.scope.type === "platform" || r.scope.id === organizationId);
  }
}

/**
 * PARÁMETROS: valores editables con definición en código (tipo, rango, valor por defecto).
 * Cambiarlos exige `rules:business` y un motivo; cada cambio es una versión nueva.
 */
export class ParameterService implements IParameterStore {
  private cache?: { at: number; values: Map<string, ParameterValue> };

  constructor(
    private readonly definitions: ParameterDefinition[],
    private readonly repo: IBusinessRuleRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly ttlMs = 30_000,
  ) {}

  async number(key: string): Promise<number> {
    return Number(await this.value(key, "number"));
  }

  async boolean(key: string): Promise<boolean> {
    return Boolean(await this.value(key, "boolean"));
  }

  async string(key: string): Promise<string> {
    return String(await this.value(key, "string"));
  }

  async list(actorId: string) {
    await this.manager(actorId);
    const values = await this.load();
    return this.definitions.map((d) => ({ ...d, value: values.get(d.key)?.value ?? d.default, changed: values.get(d.key) }));
  }

  async set(input: { actorId: string; key: string; value: number | boolean | string; reason: string }): Promise<ParameterValue> {
    const actor = await this.manager(input.actorId);
    const def = this.definitions.find((d) => d.key === input.key);
    if (!def) throw new NotFoundError(`No existe el parámetro ${input.key}.`);
    if (typeof input.value !== def.type) throw new ValidationError(`${def.key} es de tipo ${def.type}.`);
    if (typeof input.value === "number" && ((def.min !== undefined && input.value < def.min) || (def.max !== undefined && input.value > def.max) || !Number.isFinite(input.value))) {
      throw new ValidationError(`${def.key} tiene que estar entre ${def.min} y ${def.max}.`);
    }
    if (input.reason.trim().length < 10) throw new ValidationError("Explicá el motivo del cambio (queda en la auditoría).");
    const history = await this.repo.parameterHistory(def.key);
    const prev = history.at(-1);
    const v: ParameterValue = { key: def.key, value: input.value, version: (prev?.version ?? 0) + 1, updatedAt: this.clock.now(), updatedBy: actor.id, reason: input.reason.trim() };
    await this.repo.saveParameter(v); // si otro lo cambió en el mismo instante, falla (misma versión) en vez de pisarlo
    this.cache = undefined;
    await this.events.emit("parameter.changed", { userId: actor.id }, { key: def.key, from: prev?.value ?? def.default, to: input.value, reason: v.reason });
    return v;
  }

  private async value(key: string, type: ParameterDefinition["type"]) {
    const def = this.definitions.find((d) => d.key === key);
    if (!def || def.type !== type) throw new Error(`Parámetro no definido: ${key} (${type}).`);
    return (await this.load()).get(key)?.value ?? def.default;
  }

  private async load(): Promise<Map<string, ParameterValue>> {
    const now = this.clock.now().getTime();
    if (!this.cache || now - this.cache.at >= this.ttlMs) this.cache = { at: now, values: new Map((await this.repo.findParameters()).map((v) => [v.key, v])) };
    return this.cache.values;
  }

  private async manager(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("rules:business")) throw new AccessDeniedError("No tenés permiso para cambiar parámetros del negocio.", "no_permission");
    return u;
  }
}

/** Parámetros fijos (tests y usos sin base). */
export class StaticParameters implements IParameterStore {
  constructor(private readonly defs: ParameterDefinition[]) {}
  private get(key: string) {
    const d = this.defs.find((x) => x.key === key);
    if (!d) throw new Error(`Parámetro no definido: ${key}`);
    return d.default;
  }
  async number(key: string) {
    return Number(this.get(key));
  }
  async boolean(key: string) {
    return Boolean(this.get(key));
  }
  async string(key: string) {
    return String(this.get(key));
  }
}

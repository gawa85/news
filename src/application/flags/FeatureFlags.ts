import { createHash } from "node:crypto";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { FeatureFlag, FlagDefinition, User } from "../../domain/model";
import type { FlagContext, IAuthorizationService, IClock, IDomainEvents, IFeatureFlagRepository, IFeatureFlags, IUserRepository } from "../../domain/ports";


/** Balde estable 0-99 por flag y persona: la misma persona siempre cae igual. */
export function bucketOf(key: string, id: string): number {
  return createHash("sha256").update(`${key}:${id}`).digest().readUInt32BE(0) % 100;
}

export function evaluateFlag(f: FeatureFlag, ctx: FlagContext): boolean {
  if (!f.enabled) return false; // interruptor de emergencia
  if (ctx.userId && f.allowUsers.includes(ctx.userId)) return true;
  if (ctx.organizationId && f.allowOrgs.includes(ctx.organizationId)) return true;
  if (f.plans.length && (!ctx.planId || !f.plans.includes(ctx.planId))) return false;
  if (f.countries.length && (!ctx.country || !f.countries.includes(ctx.country))) return false;
  if (f.rolloutPercent >= 100) return true;
  if (f.rolloutPercent <= 0) return false;
  const id = ctx.organizationId ?? ctx.userId; // una organización entera cae junta
  return !!id && bucketOf(f.key, id) < f.rolloutPercent;
}

/**
 * FUNCIONES EN PRUEBA: se consultan con caché corta; las cambia quien tiene `flags:manage`
 * (queda en la auditoría). Sirven para lanzar de a poco y apagar algo que falla sin desplegar.
 */
export class FeatureFlagService implements IFeatureFlags {
  private cache?: { at: number; flags: Map<string, FeatureFlag> };

  constructor(
    private readonly definitions: FlagDefinition[],
    private readonly repo: IFeatureFlagRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly ttlMs = 15_000,
  ) {}

  async isEnabled(key: string, ctx: FlagContext): Promise<boolean> {
    const f = (await this.load()).get(key);
    return f ? evaluateFlag(f, ctx) : false;
  }

  async list(actorId: string): Promise<FeatureFlag[]> {
    await this.manager(actorId);
    return [...(await this.load()).values()];
  }

  async update(input: { actorId: string; key: string } & Partial<Pick<FeatureFlag, "enabled" | "rolloutPercent" | "allowUsers" | "allowOrgs" | "plans" | "countries">>): Promise<FeatureFlag> {
    const actor = await this.manager(input.actorId);
    const current = (await this.load()).get(input.key);
    if (!current) throw new NotFoundError(`No existe el flag ${input.key}.`);
    if (input.rolloutPercent !== undefined && (!Number.isInteger(input.rolloutPercent) || input.rolloutPercent < 0 || input.rolloutPercent > 100)) throw new ValidationError("El porcentaje va de 0 a 100.");
    const next: FeatureFlag = {
      ...current,
      ...Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && !["actorId", "key"].includes(k))),
      updatedAt: this.clock.now(), updatedBy: actor.id,
    };
    await this.repo.save(next);
    this.cache = undefined;
    await this.events.emit("feature_flag.changed", { userId: actor.id }, { key: next.key, enabled: next.enabled, rollout: next.rolloutPercent });
    return next;
  }

  private async load(): Promise<Map<string, FeatureFlag>> {
    const now = this.clock.now().getTime();
    if (this.cache && now - this.cache.at < this.ttlMs) return this.cache.flags;
    const stored = new Map((await this.repo.findAll()).map((f) => [f.key, f]));
    for (const d of this.definitions) {
      if (!stored.has(d.key)) {
        stored.set(d.key, { key: d.key, description: d.description, enabled: d.defaultEnabled, rolloutPercent: d.defaultRollout, allowUsers: [], allowOrgs: [], plans: [], countries: [], updatedAt: new Date(0), updatedBy: "sistema" });
      }
    }
    this.cache = { at: now, flags: stored };
    return stored;
  }

  private async manager(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("flags:manage")) throw new AccessDeniedError("No tenés permiso para cambiar funciones en prueba.", "no_permission");
    return u;
  }
}

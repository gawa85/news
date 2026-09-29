import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { Correction, Rebuttal, RebuttalStatus, RebuttalTarget, User } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  ICorrectionRepository,
  IDomainEvents,
  IIdGenerator,
  IOutletReader,
  IRebuttalRepository,
  IUserRepository,
  IVerdictReader,
  IVerdictWriter,
} from "../../domain/ports";

/**
 * DERECHO A RÉPLICA Y FE DE ERRATAS.
 *
 * REGLAS:
 *  - Sólo replica quien tiene `rebuttal:write` Y fue asignado como representante de ESE medio.
 *  - La réplica tiene que argumentar (mínimo 50 caracteres) y puede adjuntar evidencia (links).
 *  - La resuelve alguien con `rebuttal:resolve` que NO sea quien la presentó.
 *    Rechazar exige explicar por qué.
 *  - La réplica se muestra junto a la evaluación SIEMPRE, se acepte o no.
 *  - Aceptada sobre una verificación: se registra la verificación corregida y
 *    se publica automáticamente una fe de erratas.
 */
export class RebuttalService {
  constructor(
    private readonly rebuttals: IRebuttalRepository,
    private readonly corrections: ICorrectionRepository,
    private readonly verdicts: IVerdictReader & IVerdictWriter,
    private readonly users: IUserRepository,
    private readonly outlets: IOutletReader,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
  ) {}

  async submit(input: { actorId: string; outletId: string; target: RebuttalTarget; statement: string; evidenceUrls?: string[] }): Promise<Rebuttal> {
    const actor = await this.user(input.actorId);
    const perms = await this.authz.permissionsOf(actor);
    if (!perms.has("rebuttal:write") || !(actor.representsOutletIds ?? []).includes(input.outletId)) {
      throw new AccessDeniedError("Sólo un representante acreditado del medio puede presentar una réplica.", "no_permission");
    }
    if (!(await this.outlets.findById(input.outletId))) throw new NotFoundError("No existe ese medio.");
    const statement = input.statement.trim();
    if (statement.length < 50) throw new ValidationError("La réplica tiene que explicar el motivo (al menos 50 caracteres).");
    const evidenceUrls = (input.evidenceUrls ?? []).slice(0, 10);
    for (const u of evidenceUrls) if (!/^https?:\/\/\S+$/.test(u)) throw new ValidationError(`Link de evidencia inválido: ${u}`);

    const rebuttal: Rebuttal = {
      id: this.ids.next("rebuttal"),
      outletId: input.outletId,
      submittedBy: actor.id,
      target: input.target,
      statement,
      evidenceUrls,
      status: "submitted",
      createdAt: this.clock.now(),
    };
    await this.rebuttals.save(rebuttal);
    await this.events.emit("rebuttal.submitted", { userId: actor.id }, { outletId: rebuttal.outletId, target: rebuttal.target.type }, { type: "rebuttal", id: rebuttal.id });
    return rebuttal;
  }

  /** Las réplicas de los medios que represento (para seguir su estado y la resolución). */
  async mine(actorId: string): Promise<PublicRebuttal[]> {
    const actor = await this.user(actorId);
    const outlets = actor.representsOutletIds ?? [];
    const all = (await Promise.all(outlets.map((o) => this.rebuttals.findByOutlet(o)))).flat();
    return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(publicRebuttal);
  }

  /** Réplicas por resolver (las más viejas primero), sin las que quien pregunta no puede resolver. */
  async pending(actorId: string, limit = 100): Promise<Rebuttal[]> {
    const actor = await this.user(actorId);
    if (!(await this.authz.permissionsOf(actor)).has("rebuttal:resolve")) throw new AccessDeniedError("No tenés permiso para resolver réplicas.", "no_permission");
    const mine = new Set(actor.representsOutletIds ?? []);
    return (await this.rebuttals.findPending(limit)).filter((r) => r.submittedBy !== actor.id && !mine.has(r.outletId));
  }

  async resolve(input: { actorId: string; rebuttalId: string; decision: Exclude<RebuttalStatus, "submitted">; note: string }): Promise<{ rebuttal: Rebuttal; correction?: Correction }> {
    const actor = await this.user(input.actorId);
    const perms = await this.authz.permissionsOf(actor);
    if (!perms.has("rebuttal:resolve")) throw new AccessDeniedError("No tenés permiso para resolver réplicas.", "no_permission");
    if (!["accepted", "partially_accepted", "rejected"].includes(input.decision)) throw new ValidationError("La decisión tiene que ser aceptar, aceptar en parte o rechazar.");
    const r = await this.rebuttals.findById(input.rebuttalId);
    if (!r) throw new NotFoundError("No existe esa réplica.");
    if (r.status !== "submitted") throw new ConflictError("La réplica ya fue resuelta.");
    if (r.submittedBy === actor.id) throw new AccessDeniedError("No podés resolver una réplica que presentaste vos.", "no_permission");
    if ((actor.representsOutletIds ?? []).includes(r.outletId)) throw new AccessDeniedError("Representás a ese medio: tiene que resolverla otra persona.", "no_permission");
    const note = input.note.trim();
    if (note.length < 20) throw new ValidationError("Explicá la decisión (al menos 20 caracteres).");

    const now = this.clock.now();
    const resolved: Rebuttal = { ...r, status: input.decision, resolution: { by: actor.id, note, at: now } };
    await this.rebuttals.save(resolved);

    let correction: Correction | undefined;
    if (input.decision !== "rejected") {
      if (r.target.type === "verdict" && r.target.requestedStatus) {
        await this.verdicts.save({ claimId: r.target.claimId, status: r.target.requestedStatus, checkedAt: now, evidenceUrl: r.evidenceUrls[0] });
      }
      correction = await this.publishCorrection({
        actorId: actor.id,
        target: targetRef(r.target),
        outletId: r.outletId,
        description: `Por réplica del medio: ${note}`,
        rebuttalId: r.id,
      });
    }
    await this.events.emit("rebuttal.resolved", { userId: actor.id }, { decision: input.decision, outletId: r.outletId }, { type: "rebuttal", id: r.id });
    return { rebuttal: resolved, correction };
  }

  /** Fe de erratas: la plataforma corrige públicamente un error propio. */
  async publishCorrection(input: { actorId: string; target: { type: string; id: string }; outletId?: string; description: string; rebuttalId?: string }): Promise<Correction> {
    const actor = await this.user(input.actorId);
    const perms = await this.authz.permissionsOf(actor);
    if (!perms.has("corrections:publish") && !(input.rebuttalId && perms.has("rebuttal:resolve"))) {
      throw new AccessDeniedError("No tenés permiso para publicar correcciones.", "no_permission");
    }
    if (input.description.trim().length < 20) throw new ValidationError("Describí la corrección (al menos 20 caracteres).");
    const c: Correction = {
      id: this.ids.next("correction"),
      target: input.target,
      outletId: input.outletId,
      description: input.description.trim(),
      publishedBy: actor.id,
      publishedAt: this.clock.now(),
      rebuttalId: input.rebuttalId,
    };
    await this.corrections.save(c);
    await this.events.emit("correction.published", { userId: actor.id }, { description: c.description, outletId: c.outletId }, { type: "correction", id: c.id });
    return c;
  }

  /** Fe de erratas pública, lo más reciente primero. */
  /** Fe de erratas pública: sin el id interno de quien la publicó. */
  async recentCorrections(limit = 50): Promise<PublicCorrection[]> {
    return (await this.corrections.findRecent(limit)).map(publicCorrection);
  }

  /** Lo público de un medio: réplicas (todas, con su estado) y correcciones. */
  async publicRecord(outletId: string): Promise<{ rebuttals: PublicRebuttal[]; corrections: PublicCorrection[] }> {
    return {
      rebuttals: (await this.rebuttals.findByOutlet(outletId)).map(publicRebuttal),
      corrections: (await this.corrections.findByOutlet(outletId)).map(publicCorrection),
    };
  }

  private async user(id: string): Promise<User> {
    const u = await this.users.findById(id);
    if (!u) throw new NotFoundError("Usuario inexistente.");
    return u;
  }
}

function targetRef(t: RebuttalTarget): { type: string; id: string } {
  if (t.type === "verdict") return { type: "verdict", id: t.claimId };
  if (t.type === "reply") return { type: "reply", id: t.replyId };
  return { type: "credibility", id: `${t.topic}${t.dimensionId ? `/${t.dimensionId}` : ""}` };
}

/** Acreditar a una persona como representante de un medio (sólo administración de plataforma). */
export class AssignOutletRepresentativeUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly outlets: IOutletReader,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
  ) {}

  async execute(input: { actorId: string; targetId: string; outletId: string }): Promise<User> {
    const actor = await this.users.findById(input.actorId);
    if (!actor || !(await this.authz.permissionsOf(actor)).has("users:manage_all")) {
      throw new AccessDeniedError("Sólo la administración de la plataforma acredita representantes.", "no_permission");
    }
    const target = await this.users.findById(input.targetId);
    if (!target) throw new NotFoundError("Usuario inexistente.");
    if (!(await this.outlets.findById(input.outletId))) throw new NotFoundError("No existe ese medio.");
    target.representsOutletIds = [...new Set([...(target.representsOutletIds ?? []), input.outletId])];
    if (!target.roleIds.includes("outlet_rep")) target.roleIds.push("outlet_rep");
    await this.users.save(target);
    await this.events.emit("outlet_representative.assigned", { userId: actor.id }, { outletId: input.outletId }, { type: "user", id: target.id });
    return target;
  }

  /** Deja de representar a un medio; sin medios, deja también el rol de representante. */
  async revoke(input: { actorId: string; targetId: string; outletId: string }): Promise<User> {
    const actor = await this.users.findById(input.actorId);
    if (!actor || !(await this.authz.permissionsOf(actor)).has("users:manage_all")) {
      throw new AccessDeniedError("Sólo la administración de la plataforma acredita representantes.", "no_permission");
    }
    const target = await this.users.findById(input.targetId);
    if (!target) throw new NotFoundError("Usuario inexistente.");
    target.representsOutletIds = (target.representsOutletIds ?? []).filter((o) => o !== input.outletId);
    if (!target.representsOutletIds.length) target.roleIds = target.roleIds.filter((r) => r !== "outlet_rep");
    await this.users.save(target);
    await this.events.emit("outlet_representative.removed", { userId: actor.id }, { outletId: input.outletId }, { type: "user", id: target.id });
    return target;
  }
}

/** Lo que se publica de una réplica: el medio, qué pidió y cómo se resolvió; no quién (ids internos). */
export type PublicRebuttal = Omit<Rebuttal, "submittedBy" | "resolution"> & { resolution?: { note: string; at: Date } };
export type PublicCorrection = Omit<Correction, "publishedBy">;

const publicRebuttal = ({ submittedBy: _s, resolution, ...r }: Rebuttal): PublicRebuttal => ({ ...r, ...(resolution ? { resolution: { note: resolution.note, at: resolution.at } } : {}) });
const publicCorrection = ({ publishedBy: _p, ...c }: Correction): PublicCorrection => c;

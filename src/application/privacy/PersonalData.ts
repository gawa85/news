import { ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { Repositories } from "../../domain/ports";
import type { IClock, IDataStore, IDomainEvents } from "../../domain/ports";

export const DELETE_CONFIRMATION = "BORRAR MIS DATOS";

/**
 * DERECHOS SOBRE LOS DATOS PERSONALES (Ley 25.326: acceso, rectificación y supresión).
 *
 * Exportar: todo lo que la plataforma guarda de la persona, en un solo archivo.
 * Borrar:
 *  - Se borran análisis, reseñas, reglas, alertas, fuentes conectadas (y sus secretos),
 *    contraseña, sesiones y claves de API; se liberan sus direcciones de canal.
 *  - La cuenta queda ANONIMIZADA (no se borra el registro) para no romper la historia
 *    de terceros: respuestas publicadas, moderaciones, auditoría.
 *  - Las FACTURAS se conservan: lo exige la normativa fiscal.
 *  - El último administrador de una organización con más miembros primero tiene que
 *    designar a otro.
 *  - Todo en una transacción: o se borra todo o nada.
 */
export class PersonalDataService {
  constructor(
    private readonly store: IDataStore,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
  ) {}

  async exportMyData(userId: string): Promise<Record<string, unknown>> {
    const r = this.store.repos;
    const user = await r.users.findById(userId);
    if (!user || user.status === "deleted") throw new NotFoundError("No hay datos de esa cuenta.");
    const self = { type: "user" as const, id: user.id };
    const data = {
      exportedAt: this.clock.now(),
      account: { id: user.id, name: user.name, status: user.status, createdAt: user.createdAt, organizationId: user.organizationId, roles: user.roleIds, preferredChannel: user.preferredChannel },
      channels: user.channels,
      subscription: await r.subscriptions.findCurrent(self),
      analyses: (await r.contentAnalyses.findByUser(user.id, 10_000)).map((a) => ({ at: a.analyzedAt, source: a.item.sourceType, title: a.item.title, text: a.item.text, smokeIndex: a.smoke.smokeIndex })),
      reviews: await r.reviews.findByAuthor(user.id),
      ruleSets: await r.ruleSets.findByOwner(self),
      alerts: await r.alerts.findByUser(user.id),
      reportSchedules: await r.reportSchedules.findByOwner(user.id),
      preferences: await r.preferences.findUser(user.id),
      learning: { progress: await r.learning.getState(user.id), classrooms: await r.learning.findMemberships(user.id) },
      supportTickets: (await r.tickets.findByRequester(user.id)).map((t) => ({ ...t, messages: t.messages.filter((m) => !m.internal) })),
      usageStats: await r.stats.find({ scope: "user", scopeId: user.id, fromDay: "0000-00-00", toDay: "9999-99-99" }),
      connectedSources: (await r.sourceConnections.findByUser(user.id)).map(({ secretRef: _s, ...c }) => c),
      apiKeys: (await r.apiKeys.findByUser(user.id)).map(({ hash: _h, ...k }) => k),
      sessions: (await r.sessions.findByUser(user.id)).map((s) => ({ method: s.method, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, userAgent: s.userAgent, revoked: s.revoked })),
      invoices: await r.invoices.findBySubject(self),
      activity: await r.audit.find({ actorId: user.id, limit: 10_000 }),
      archivedPages: (await r.evidence.findByRequester(user.id, 10_000)).map((e) => ({ id: e.id, url: e.url, capturedAt: e.capturedAt, status: e.status, sha256: e.rawSha256, monitorUntil: e.monitorUntil })),
    };
    await this.events.emit("personal_data.exported", { userId: user.id, organizationId: user.organizationId });
    return data;
  }

  async deleteMyData(input: { userId: string; confirmation: string }): Promise<void> {
    if (input.confirmation !== DELETE_CONFIRMATION) throw new ValidationError(`Para confirmar escribí exactamente: ${DELETE_CONFIRMATION}`);
    const user = await this.store.repos.users.findById(input.userId);
    if (!user || user.status === "deleted") throw new NotFoundError("No hay datos de esa cuenta.");

    if (user.organizationId) {
      const members = await this.store.repos.users.findByOrganization(user.organizationId);
      const roles = await this.store.repos.roles.findAll();
      const adminRoles = new Set(roles.filter((x) => x.permissions.includes("users:manage_org")).map((x) => x.id));
      const isAdmin = user.roleIds.some((id) => adminRoles.has(id));
      const otherAdmins = members.filter((m) => m.id !== user.id && m.status === "active" && m.roleIds.some((id) => adminRoles.has(id)));
      if (isAdmin && otherAdmins.length === 0 && members.some((m) => m.id !== user.id && m.status === "active")) {
        throw new ConflictError("Sos el único administrador de tu organización: designá a otra persona antes de borrar tus datos.");
      }
    }

    await this.store.transaction(async (r: Repositories) => {
      const self = { type: "user" as const, id: user.id };
      for (const c of await r.sourceConnections.findByUser(user.id)) if (c.secretRef) await r.secrets.delete(c.secretRef);
      await r.sourceConnections.deleteByUser(user.id);
      await r.contentAnalyses.deleteByUser(user.id);
      await r.reviews.deleteByAuthor(user.id);
      await r.ruleSets.deleteByOwner(self);
      await r.alerts.deleteByUser(user.id);
      await r.reportSchedules.deleteByOwner(user.id);
      await r.preferences.deleteUser(user.id);
      await r.learning.deletePlayer(user.id);
      // Los tickets se conservan (historial del servicio) pero sin datos de la persona.
      for (const t of await r.tickets.findByRequester(user.id)) {
        await r.tickets.save({ ...t, requesterId: "borrado", subject: "(borrado a pedido)", messages: t.messages.map((m) => (m.role === "requester" ? { ...m, authorId: "borrado", text: "(borrado a pedido)" } : m)) });
      }
      // Las copias de páginas públicas se conservan (son evidencia, no datos de la persona), pero
      // sin saber quién las pidió y sin seguimiento a su nombre. `requestedBy` no está en la huella.
      for (const e of await r.evidence.findByRequester(user.id, 100_000)) {
        await r.evidence.save({ ...e, requestedBy: "borrado", subjectId: e.subjectId === user.id ? "borrado" : e.subjectId, monitorUntil: undefined });
      }
      // Las del seguimiento automático, pagadas por la persona (cuenta individual).
      for (const e of await r.evidence.findBySubject(user.id)) await r.evidence.save({ ...e, subjectId: "borrado", monitorUntil: undefined });
      // Sus estadísticas personales se borran; en las globales sólo queda un seudónimo irreversible.
      await r.stats.deleteScope("user", user.id);
      await r.credentials.deleteByUser(user.id);
      for (const s of await r.sessions.findByUser(user.id)) await r.sessions.save({ ...s, revoked: true, userAgent: undefined, ip: undefined });
      for (const k of await r.apiKeys.findByUser(user.id)) await r.apiKeys.save({ ...k, revoked: true });
      await r.users.releaseChannels(user.id);
      await r.users.save({
        ...user,
        name: "Cuenta eliminada",
        status: "deleted",
        channels: [],
        preferredChannel: undefined,
        representsOutletIds: [],
      });
    });
    await this.events.emit("personal_data.deleted", { userId: user.id, organizationId: user.organizationId });
  }
}

export interface RetentionPolicy {
  /** Análisis de contenido (textos que la gente mandó). */
  contentAnalysesDays: number;
  /** Registro de envíos (sólo hashes, pero no hace falta guardarlo para siempre). */
  deliveryLogDays: number;
  loginAttemptsDays: number;
  finishedJobsDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { contentAnalysesDays: 365, deliveryLogDays: 90, loginAttemptsDays: 30, finishedJobsDays: 30 };

/** Aplica la política de retención (tarea diaria). */
export class RetentionUseCase {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: IClock,
    private readonly policy: RetentionPolicy = DEFAULT_RETENTION,
  ) {}

  async execute(): Promise<Record<string, string>> {
    const now = this.clock.now().getTime();
    const before = (days: number) => new Date(now - days * 86_400_000);
    await this.repos.contentAnalyses.deleteOlderThan(before(this.policy.contentAnalysesDays));
    await this.repos.deliveryLog.deleteOlderThan(before(this.policy.deliveryLogDays));
    await this.repos.loginAttempts.deleteOlderThan(before(this.policy.loginAttemptsDays));
    await this.repos.jobs.deleteFinishedBefore(before(this.policy.finishedJobsDays));
    return Object.fromEntries(Object.entries(this.policy).map(([k, d]) => [k, before(d).toISOString()]));
  }
}

import { AccessDeniedError } from "../../domain/errors";
import type { AuditEntry, AuditFilter, DomainEvent, DomainEventType } from "../../domain/model";
import type { IAuditLog, IAuthorizationService, IClock, IDomainEvents, IEventBus, IIdGenerator, IUserRepository } from "../../domain/ports";

/** Publica eventos del dominio en el bus (auditoría, webhooks y lo que se sume). */
export class DomainEventPublisher implements IDomainEvents {
  constructor(
    private readonly bus: IEventBus,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
  ) {}

  emit(type: DomainEventType, actor: { userId: string; organizationId?: string }, data: Record<string, unknown> = {}, target?: DomainEvent["target"]): Promise<void> {
    return this.bus.publish({ id: this.ids.next("evt"), type, userId: actor.userId, organizationId: actor.organizationId, target, occurredAt: this.clock.now(), data });
  }
}

const SECRET_KEYS = /pass|token|secret|key|code|hash/i;

/**
 * Escucha TODOS los eventos y los guarda en la auditoría.
 * Los casos de uso no saben que existe: sólo publican eventos (OCP).
 * Por las dudas, se eliminan campos con nombre de secreto.
 */
export class AuditRecorder {
  constructor(private readonly audit: IAuditLog) {}

  attach(bus: IEventBus): void {
    bus.subscribe((e) => this.audit.record(this.toEntry(e)));
  }

  private toEntry(e: DomainEvent): AuditEntry {
    const data = Object.fromEntries(Object.entries(e.data).filter(([k]) => !SECRET_KEYS.test(k)));
    return { id: e.id, at: e.occurredAt, action: e.type, actorId: e.userId, organizationId: e.organizationId, target: e.target, data };
  }
}

/**
 * Consultar la auditoría. REGLAS: permiso `audit:read`; un admin de organización
 * ve sólo lo de su organización; la plataforma completa, sólo `users:manage_all`.
 */
export class AuditQueryUseCase {
  constructor(
    private readonly audit: IAuditLog,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
  ) {}

  async execute(input: { actorId: string; filter: AuditFilter }): Promise<AuditEntry[]> {
    const actor = await this.users.findById(input.actorId);
    const perms = actor ? await this.authz.permissionsOf(actor) : new Set();
    if (!actor || !perms.has("audit:read")) throw new AccessDeniedError("No tenés acceso a la auditoría.", "no_permission");
    if (perms.has("users:manage_all")) return this.audit.find(input.filter);
    if (!actor.organizationId) throw new AccessDeniedError("La auditoría es por organización.", "no_permission");
    return this.audit.find({ ...input.filter, organizationId: actor.organizationId });
  }
}

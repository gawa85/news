import type { AuditEntry, AuditFilter, DomainEvent, DomainEventType } from "../model";

export interface IAuditLog {
  record(entry: AuditEntry): Promise<void>;
  find(filter: AuditFilter): Promise<AuditEntry[]>;
}

/**
 * Publica eventos del dominio (los usan la auditoría y los webhooks).
 * Los casos de uso lo reciben en lugar del bus crudo: sólo dicen QUÉ pasó.
 */
export interface IDomainEvents {
  emit(type: DomainEventType, actor: { userId: string; organizationId?: string }, data?: Record<string, unknown>, target?: DomainEvent["target"]): Promise<void>;
}

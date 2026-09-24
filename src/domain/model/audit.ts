/**
 * AUDITORÍA: registro inmutable de quién hizo qué y cuándo.
 * Para una plataforma que evalúa la credibilidad de otros, poder mostrar su propio
 * historial de decisiones (roles, verificaciones, réplicas, respuestas) es parte del producto.
 */
export interface AuditEntry {
  id: string;
  at: Date;
  action: string;
  actorId: string;
  organizationId?: string;
  target?: { type: string; id: string };
  /** Detalle sin datos secretos (nunca contraseñas, tokens ni claves). */
  data: Record<string, unknown>;
}

export interface AuditFilter {
  organizationId?: string;
  actorId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

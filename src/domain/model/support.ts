/**
 * SOPORTE: tickets con prioridad y tiempo de primera respuesta según el plan.
 */
export type TicketCategory = "account" | "billing" | "bug" | "content_dispute" | "data_request" | "other";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "pending" | "solved" | "closed";

export interface TicketMessage {
  id: string;
  authorId: string;
  role: "requester" | "agent" | "system";
  text: string;
  /** Nota interna del equipo: la persona no la ve. */
  internal: boolean;
  at: Date;
}

export interface Ticket {
  id: string;
  requesterId: string;
  organizationId?: string;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  channel: string;
  assigneeId?: string;
  messages: TicketMessage[];
  firstResponseDueAt: Date;
  firstRespondedAt?: Date;
  slaBreached: boolean;
  satisfaction?: number;
  externalId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------- Feature flags ----------------

/**
 * FUNCIONES EN PRUEBA (feature flags): prender o apagar código nuevo sin desplegar,
 * de a poco (porcentaje estable por persona) o para personas, organizaciones, planes o países.
 * No reemplazan a los planes (qué se vende) ni a las reglas (qué se permite): son para lanzar.
 */
export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  /** 0-100: porcentaje de personas (siempre las mismas para el mismo flag). */
  rolloutPercent: number;
  allowUsers: string[];
  allowOrgs: string[];
  plans: string[];
  countries: string[];
  updatedAt: Date;
  updatedBy: string;
}

/** Flag conocido por el código (con su valor inicial). */
export interface FlagDefinition {
  key: string;
  description: string;
  defaultEnabled: boolean;
  defaultRollout: number;
}

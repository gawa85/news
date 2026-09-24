/**
 * CUMPLIMIENTO Y REPUTACIÓN DE ENVÍO.
 * La forma sostenible de no ser bloqueado es respetar las reglas de cada plataforma:
 * frecuencia, consentimiento, identificación como bot y reacción ante advertencias.
 * (No hay rotación de cuentas, números ni IPs: eso viola las reglas de las plataformas.)
 */
export interface PlatformPolicy {
  /** "whatsapp", "email", "telegram", "discourse:*", "wordpress:blog.example"... */
  destination: string;
  maxPerMinute?: number;
  maxPerHour?: number;
  maxPerDay?: number;
  /** Mínimo entre dos envíos al MISMO destinatario/hilo. */
  minSecondsPerRecipient?: number;
  /** Sólo se puede escribir a quien antes escribió o aceptó (opt-in). */
  requiresOptIn: boolean;
  /** Ventana de conversación (WhatsApp: 24 h desde el último mensaje del usuario). */
  conversationWindowHours?: number;
  /** Fuera de la ventana sólo se permiten plantillas aprobadas. */
  templatesOutsideWindow?: boolean;
  requiresBotDisclosure: boolean;
  requiresUnsubscribe: boolean;
  notes?: string;
}

export type DeliveryOutcome =
  | "sent"
  | "blocked_by_policy"
  | "failed"
  | "provider_throttled" // 429 o equivalente
  | "provider_rejected"; // 403, spam, cuenta advertida

export interface DeliveryAttempt {
  id: string;
  destination: string;
  /** Hash del destinatario: sirve para limitar frecuencia sin guardar el dato personal. */
  recipientHash: string;
  at: Date;
  outcome: DeliveryOutcome;
  detail?: string;
}

export type HealthState = "healthy" | "cooling_down" | "paused";

/** Estado de un destino: si empieza a advertir o limitar, se frena solo. */
export interface DestinationHealth {
  destination: string;
  state: HealthState;
  reason?: string;
  until?: Date;
  consecutiveFailures: number;
  updatedAt: Date;
}

export interface OptOut {
  channel: string;
  address: string;
  at: Date;
  reason: string;
}

export type SendPurpose =
  | "reply" // respuesta a algo que la persona pidió
  | "notification" // aviso que la persona configuró (alertas)
  | "verification"; // código de verificación

export interface SendContext {
  destination: string;
  recipient: string;
  purpose: SendPurpose;
  /** Si el mensaje es una plantilla aprobada por la plataforma. */
  isTemplate?: boolean;
}

export type ComplianceDecision =
  | { allowed: true; mustDiscloseBot: boolean; mustIncludeUnsubscribe: boolean }
  | { allowed: false; code: "opted_out" | "outside_window" | "rate_limited" | "destination_paused" | "no_consent"; message: string; retryAt?: Date };

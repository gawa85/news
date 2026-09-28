/**
 * ABUSO: uso automatizado, spam y cuentas en masa. Frenarlo protege el costo (cada audio,
 * imagen o sello se paga), la reputación de los números de WhatsApp y a las personas reales.
 */

/** Qué se está por hacer (cada acción tiene sus límites). */
export type AbuseAction =
  | "signup" // crear una cuenta por la web
  | "login" // entrar con contraseña
  | "magic_link" // pedir un enlace de acceso por mail
  | "inbound_message" // mensaje por WhatsApp, Telegram…
  | "api_request" // pedido a la API o al MCP
  | "expensive"; // funciones con costo por uso (audio, imagen, archivo)

/** A quién se le aplica un límite o una restricción. */
export type AbuseTargetKind = "user" | "ip" | "address" | "email";

export interface AbuseTarget {
  kind: AbuseTargetKind;
  value: string;
}

export interface AbuseContext {
  action: AbuseAction;
  at: Date;
  userId?: string;
  ip?: string;
  /** Dirección en el canal (número de WhatsApp, chat de Telegram). */
  address?: string;
  email?: string;
  userAgent?: string;
  /** Token del captcha, si la pantalla lo mostró. */
  captchaToken?: string;
  /** Un tercero ya verificó a la persona (Google): no se le pide captcha por política. */
  captchaExempt?: boolean;
}

export type AbuseSignalType =
  | "rate_limit" // pasó un límite de frecuencia
  | "signup_velocity" // muchas cuentas nuevas desde la misma red
  | "disposable_email" // mail descartable
  | "automation" // cliente automatizado sin identificarse
  | "restricted"; // tiene una restricción vigente

export interface AbuseSignal {
  type: AbuseSignalType;
  /** 0-100: cuánto suma al puntaje. */
  weight: number;
  detail: string;
}

/** Lo que hay que hacer con el pedido. */
export type AbuseDecision =
  | { outcome: "allow"; signals: AbuseSignal[] }
  /** Pedir un captcha (sólo en la web; en los canales de chat equivale a rechazar). */
  | { outcome: "challenge"; reason: string; signals: AbuseSignal[] }
  | { outcome: "deny"; reason: string; retryAfterSeconds?: number; signals: AbuseSignal[] };

/** Límite de frecuencia de una acción (son DATOS: config/abuse.ts). */
export interface RateRule {
  action: AbuseAction;
  /** Qué se cuenta: por persona, por red (IP), por dirección de chat o por mail. */
  per: AbuseTargetKind;
  limit: number;
  windowSeconds: number;
  /** Al pasarlo: pedir captcha (web) o rechazar. */
  onExceed: "challenge" | "deny";
}

/** Restricción manual o automática sobre una persona, una red, una dirección o un mail. */
export interface Restriction {
  id: string;
  target: AbuseTarget;
  level: "challenge" | "block";
  reason: string;
  createdAt: Date;
  /** Sin fecha: hasta que alguien la levante. */
  until?: Date;
  createdBy: string;
  automatic: boolean;
  liftedAt?: Date;
  liftedBy?: string;
}

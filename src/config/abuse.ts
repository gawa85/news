/**
 * LÍMITES CONTRA EL ABUSO. Son DATOS: se ajustan sin tocar el código.
 * Criterio: holgados para una persona real (nadie manda 20 mensajes por minuto a mano),
 * cortos para un programa. Revisarlos con el uso real.
 */
import type { AbuseAction, RateRule } from "../domain/model";

export const RATE_RULES: RateRule[] = [
  // Cuentas nuevas por la web: pocas por red; si se pasa, captcha; muchas más, no.
  { action: "signup", per: "ip", limit: 5, windowSeconds: 3_600, onExceed: "challenge" },
  { action: "signup", per: "ip", limit: 30, windowSeconds: 86_400, onExceed: "deny" },
  // Cada pedido de alta manda un mail a esa casilla: pocos por hora (no se puede bombardear a nadie).
  { action: "signup", per: "email", limit: 3, windowSeconds: 3_600, onExceed: "deny" },
  // Contraseña: además del bloqueo por mail que ya existe, un tope por red (prueba de claves en masa).
  { action: "login", per: "ip", limit: 30, windowSeconds: 600, onExceed: "challenge" },
  { action: "login", per: "ip", limit: 200, windowSeconds: 3_600, onExceed: "deny" },
  // Enlaces de acceso: cada uno es un mail enviado (costo y reputación del dominio).
  { action: "magic_link", per: "email", limit: 5, windowSeconds: 3_600, onExceed: "deny" },
  { action: "magic_link", per: "ip", limit: 20, windowSeconds: 3_600, onExceed: "challenge" },
  // Chat: cada respuesta por WhatsApp se paga y un número que responde spam pierde calidad.
  { action: "inbound_message", per: "address", limit: 20, windowSeconds: 60, onExceed: "deny" },
  { action: "inbound_message", per: "address", limit: 400, windowSeconds: 86_400, onExceed: "deny" },
  // API y MCP: además de los cupos del plan, un tope de frecuencia por persona.
  { action: "api_request", per: "user", limit: 120, windowSeconds: 60, onExceed: "deny" },
  { action: "api_request", per: "ip", limit: 600, windowSeconds: 60, onExceed: "deny" },
  // Funciones con costo por uso (audio, imagen, archivo): tope por hora.
  { action: "expensive", per: "user", limit: 40, windowSeconds: 3_600, onExceed: "deny" },
  // Salas y eventos: además del modo lento, un tope por persona (frena a quien copa la conversación).
  { action: "room_message", per: "user", limit: 30, windowSeconds: 600, onExceed: "deny" },
];

/** Acciones que SIEMPRE piden captcha en la web (si hay un verificador configurado). */
export const CAPTCHA_ALWAYS: AbuseAction[] = ["signup"];

/** Si pasa este tope, la restricción deja de ser momentánea: bloqueo automático por un rato. */
export const AUTO_BLOCK = { rejectionsInWindow: 5, windowSeconds: 3_600, blockSeconds: 6 * 3_600 };

/**
 * Dominios de mail descartables (los más comunes). Para una lista completa, cargar una
 * pública (p. ej. disposable-email-domains) con DISPOSABLE_EMAIL_DOMAINS_FILE.
 */
export const DISPOSABLE_EMAIL_DOMAINS = [
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "sharklasers.com", "10minutemail.com", "10minutemail.net",
  "tempmail.com", "temp-mail.org", "temp-mail.io", "yopmail.com", "yopmail.net", "trashmail.com", "getnada.com", "nada.email",
  "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mailnesia.com", "mintemail.com", "mohmal.com",
  "emailondeck.com", "spamgourmet.com", "tempr.email", "discard.email", "mail.tm", "burnermail.io", "moakt.com", "tmail.ws",
];

/**
 * SALAS: reglas puras de los eventos en vivo.
 */
import type { EventInfo } from "../model";

export type EventStatus = "scheduled" | "live" | "closed";

/** Antes de empezar: programado (se puede leer, no escribir). Después de terminar o cerrado: cerrado. */
export function eventStatus(e: EventInfo, now: Date): EventStatus {
  if (e.closedAt || now >= e.endsAt) return "closed";
  return now >= e.startsAt ? "live" : "scheduled";
}

export function isMuted(e: EventInfo, userId: string, now: Date): Date | undefined {
  return e.muted.find((m) => m.userId === userId && m.until > now)?.until;
}

/** Seudónimo legible a partir de una huella ("Participante 4F2A"): estable en la sala, distinto en cada sala. */
export function aliasFromDigest(hex: string): string {
  return `Participante ${hex.slice(0, 4).toUpperCase()}`;
}

/** Código corto y legible para un evento (sin letras que se confunden: 0/O, 1/I/L). */
export function eventCodeFrom(n: number): string {
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  let x = Math.abs(Math.floor(n));
  for (let i = 0; i < 6; i++) {
    out += ALPHABET[x % ALPHABET.length];
    x = Math.floor(x / ALPHABET.length);
  }
  return out;
}

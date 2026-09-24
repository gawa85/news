/**
 * RESUMEN: cuándo le toca a cada persona (reglas puras, en su hora local).
 */
import type { DigestKind } from "../model";

const pad = (n: number) => String(n).padStart(2, "0");

/** Semana ISO ("2026-W39") de una fecha (ya en hora local). */
export function isoWeekKey(local: Date): string {
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // el jueves de esa semana define el año
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(week)}`;
}

export interface DigestSchedule {
  /** Hora local de envío (0-23). */
  hour: number;
  /** Día del semanal: 1 = lunes … 7 = domingo. */
  weekday: number;
}

/**
 * ¿Toca mandar el resumen ahora? Diario: desde la hora elegida de cada día.
 * Semanal: desde la hora elegida del día elegido (si se pasó, se manda apenas se pueda
 * esa misma semana: un servidor caído no hace perder el resumen).
 */
export function digestDue(kind: DigestKind, now: Date, utcOffsetMinutes: number, s: DigestSchedule): { due: boolean; periodKey: string } {
  const local = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (kind === "daily") {
    return { due: minutes >= s.hour * 60, periodKey: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` };
  }
  const weekday = local.getUTCDay() || 7;
  return { due: weekday > s.weekday || (weekday === s.weekday && minutes >= s.hour * 60), periodKey: isoWeekKey(local) };
}

/** Desde cuándo contar: el último resumen enviado, o el largo del período si es el primero. */
export function digestWindowStart(kind: DigestKind, now: Date, lastSentTo?: Date): Date {
  const span = (kind === "daily" ? 1 : 7) * 86_400_000;
  // Nunca más de dos períodos atrás (si estuvo apagado un mes, no se manda un mes entero).
  const floor = new Date(now.getTime() - 2 * span);
  if (lastSentTo && lastSentTo > floor) return lastSentTo;
  return new Date(now.getTime() - span);
}

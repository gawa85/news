/**
 * ABUSO: reglas puras (sin red ni base).
 */
import { isIP } from "node:net";
import type { AbuseContext, AbuseDecision, AbuseSignal, AbuseTarget, AbuseTargetKind, RateRule } from "../model";

/**
 * La "red" de una IP para contar: en IPv6 cada conexión puede tener millones de direcciones
 * (un /64 entero), así que se cuenta por /64. En IPv4, la dirección.
 */
export function ipBucket(ip: string): string {
  const v = ip.trim().toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
  if (isIP(v) !== 6) return v;
  const [head = "", tail = ""] = v.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const full = v.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${full.slice(0, 4).map((h) => (h || "0").replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * Mail para contar: sin mayúsculas, sin "+etiqueta" y, en Gmail, sin puntos
 * (ana.perez+1@gmail.com = anaperez@gmail.com: es la misma casilla).
 */
export function canonicalEmail(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const base = local.split("+")[0]!;
  const d = domain === "googlemail.com" ? "gmail.com" : domain;
  return `${d === "gmail.com" ? base.replace(/\./g, "") : base}@${d}`;
}

/** El valor que se cuenta para cada tipo de destino (undefined si el pedido no lo trae). */
export function targetValue(kind: AbuseTargetKind, ctx: AbuseContext): string | undefined {
  switch (kind) {
    case "user":
      return ctx.userId;
    case "ip":
      return ctx.ip ? ipBucket(ctx.ip) : undefined;
    case "address":
      return ctx.address;
    case "email":
      return ctx.email ? canonicalEmail(ctx.email) : undefined;
  }
}

/** Todos los destinos que identifican al pedido (para buscar restricciones). */
export function targetsOf(ctx: AbuseContext): AbuseTarget[] {
  return (["user", "ip", "address", "email"] as const)
    .map((kind) => ({ kind, value: targetValue(kind, ctx) }))
    .filter((t): t is AbuseTarget => !!t.value);
}

export function rateKey(rule: RateRule, ctx: AbuseContext): string | undefined {
  const v = targetValue(rule.per, ctx);
  return v ? `${rule.action}:${rule.per}:${rule.windowSeconds}:${v}` : undefined;
}

export interface AbuseThresholds {
  /** Desde este puntaje se pide captcha. */
  challenge: number;
  /** Desde este puntaje se rechaza. */
  deny: number;
}

export const DEFAULT_ABUSE_THRESHOLDS: AbuseThresholds = { challenge: 50, deny: 90 };

/** Combina las señales (por tipo, la más fuerte) y decide. */
export function decideAbuse(signals: AbuseSignal[], t: AbuseThresholds = DEFAULT_ABUSE_THRESHOLDS): AbuseDecision {
  const strongest = new Map<string, AbuseSignal>();
  for (const s of signals) if ((strongest.get(s.type)?.weight ?? -1) < s.weight) strongest.set(s.type, s);
  const kept = [...strongest.values()].sort((a, b) => b.weight - a.weight);
  const score = Math.min(100, kept.reduce((n, s) => n + s.weight, 0));
  const reason = kept.map((s) => s.detail).join(" ");
  if (score >= t.deny) return { outcome: "deny", reason, signals: kept };
  if (score >= t.challenge) return { outcome: "challenge", reason, signals: kept };
  return { outcome: "allow", signals: kept };
}

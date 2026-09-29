/**
 * REGLAS DE PRECIOS: funciones puras (sin base), para cotizar y validar cupones.
 */
import type { BillingInterval, Coupon, CountryConfig, Plan, PriceQuote } from "../model";
import { priceFor } from "../model";

export interface CouponCheck {
  planId: string;
  interval: BillingInterval;
  currency: string;
  now: Date;
  subjectKey: string;
  /** ¿Ya pagó alguna vez? */
  hasPaidBefore: boolean;
  /** ¿Ya usó este cupón? */
  alreadyRedeemed: boolean;
}

/** Motivo por el que el cupón no vale (undefined = vale). */
export function couponProblem(c: Coupon, k: CouponCheck): string | undefined {
  if (!c.active) return "El cupón no está activo.";
  if (c.validFrom && k.now < c.validFrom) return "El cupón todavía no está vigente.";
  if (c.validTo && k.now > c.validTo) return "El cupón venció.";
  if (c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions) return "El cupón ya se usó todas las veces posibles.";
  if (c.planIds.length && !c.planIds.includes(k.planId)) return "El cupón no vale para ese plan.";
  if (!c.intervals.includes(k.interval)) return `El cupón no vale para el pago ${k.interval === "year" ? "anual" : "mensual"}.`;
  if (c.newCustomersOnly && k.hasPaidBefore) return "El cupón es sólo para quien contrata por primera vez.";
  if (c.restrictedTo && `${c.restrictedTo.type}:${c.restrictedTo.id}` !== k.subjectKey) return "Ese cupón es personal.";
  if (k.alreadyRedeemed) return "Ya usaste ese cupón.";
  if (c.kind === "fixed" && c.currency !== k.currency) return "El cupón es de otra moneda.";
  return undefined;
}

export function discountFor(c: Coupon, listAmount: number): number {
  const raw = c.kind === "percent" ? (listAmount * Math.min(100, Math.max(0, c.value))) / 100 : c.value;
  return Math.min(listAmount, Math.round(raw * 100) / 100);
}

/** Cotiza un plan: precio de lista del país, descuento del cupón (si vale) e impuestos. */
export function quote(plan: Plan, interval: BillingInterval, country: CountryConfig, coupon?: Coupon): PriceQuote {
  const price = country.planPrices?.[plan.id]?.[interval] ?? priceFor(plan, interval);
  if (!price) throw new Error(`El plan ${plan.name} no tiene precio ${interval === "year" ? "anual" : "mensual"}.`);
  const discount = coupon ? discountFor(coupon, price.amount) : 0;
  const amount = Math.round((price.amount - discount) * 100) / 100;
  const rate = country.tax.rate;
  const taxAmount = country.tax.includedInPrice ? Math.round((amount - amount / (1 + rate)) * 100) / 100 : Math.round(amount * rate * 100) / 100;
  const monthly = country.planPrices?.[plan.id]?.month ?? priceFor(plan, "month");
  return {
    planId: plan.id,
    interval,
    currency: price.currency,
    listAmount: price.amount,
    discount,
    amount: country.tax.includedInPrice ? amount : Math.round((amount + taxAmount) * 100) / 100,
    coupon: coupon ? { code: coupon.code, description: coupon.description, cycles: coupon.durationCycles } : undefined,
    tax: { name: country.tax.name, rate, included: country.tax.includedInPrice, amount: taxAmount },
    country: country.code,
    yearlySavings: interval === "year" && monthly ? Math.max(0, monthly.amount * 12 - price.amount) : undefined,
  };
}

/**
 * Qué le QUITA un cambio de plan a quien ya lo tiene: funciones o canales que desaparecen y
 * límites que bajan (`null` es sin límite: pasar a un número también es bajar).
 * Con suscripciones vigentes, esos cambios no se hacen sobre el plan (se crea otro).
 */
export function planReductions(before: Plan, after: Plan): string[] {
  const out: string[] = [];
  for (const f of before.features) if (!after.features.includes(f)) out.push(`deja de incluir ${f}`);
  for (const c of before.channels) if (!after.channels.includes(c)) out.push(`deja de incluir el canal ${c}`);
  for (const k of Object.keys(before.limits) as (keyof Plan["limits"])[]) {
    const a = before.limits[k];
    const b = after.limits[k];
    if (b !== null && (a === null || b < a)) out.push(`baja ${k} de ${a ?? "sin límite"} a ${b}`);
  }
  return out;
}

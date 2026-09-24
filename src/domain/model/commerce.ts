import type { BillingSubject, Plan, Price } from "./plans";

/**
 * COMERCIAL: plan anual, cupones, referidos y marca blanca.
 */
export type BillingInterval = "month" | "year";

/** Precio de un plan según el período (el anual es opcional: suele traer meses de regalo). */
export function priceFor(plan: Plan, interval: BillingInterval): Price | null {
  if (!plan.price) return null;
  if (interval === "month") return plan.price.interval === "month" ? plan.price : null;
  return plan.yearlyPrice ?? (plan.price.interval === "year" ? plan.price : null);
}

export interface Coupon {
  /** Código que escribe la persona (mayúsculas, sin espacios). */
  code: string;
  description: string;
  kind: "percent" | "fixed";
  /** Porcentaje (1-100) o monto fijo en `currency`. */
  value: number;
  currency?: string;
  /** Planes donde vale (vacío = todos los pagos). */
  planIds: string[];
  intervals: BillingInterval[];
  /** Cuántos cobros cubre (1 = el primero; null = siempre). */
  durationCycles: number | null;
  maxRedemptions: number | null;
  redemptions: number;
  /** Sólo para quien nunca pagó. */
  newCustomersOnly: boolean;
  /** Cupón personal (p. ej. premio de un referido): sólo lo usa ese sujeto. */
  restrictedTo?: BillingSubject;
  validFrom?: Date;
  validTo?: Date;
  active: boolean;
  source: "manual" | "referral_welcome" | "referral_reward";
  createdBy: string;
  createdAt: Date;
}

export interface CouponRedemption {
  id: string;
  code: string;
  subject: BillingSubject;
  subscriptionId: string;
  discount: number;
  at: Date;
}

export interface PriceQuote {
  planId: string;
  interval: BillingInterval;
  currency: string;
  listAmount: number;
  discount: number;
  /** Lo que se cobra ahora (con impuestos incluidos, como se muestra en Argentina). */
  amount: number;
  coupon?: { code: string; description: string; cycles: number | null };
  tax: { name: string; rate: number; included: boolean; amount: number };
  country: string;
  /** Ahorro del plan anual respecto de pagar 12 meses. */
  yearlySavings?: number;
}

// ---------------- Referidos ----------------

export interface ReferralCode {
  code: string;
  ownerId: string;
  createdAt: Date;
}

export interface ReferralUse {
  /** Una vez por persona referida. */
  id: string;
  code: string;
  referrerId: string;
  referredUserId: string;
  at: Date;
  status: "pending" | "rewarded" | "rejected";
  reason?: string;
  welcomeCoupon?: string;
  rewardCoupon?: string;
}

// ---------------- Marca blanca ----------------

export interface Branding {
  organizationId: string;
  displayName: string;
  logoUrl?: string;
  /** Color principal en #RRGGBB. */
  primaryColor?: string;
  footer?: string;
  /** Nombre que figura como remitente de los mails. */
  emailFromName?: string;
  customDomain?: string;
  /** Verificación del dominio con un registro TXT: sinhumo-verify=<token>. */
  domainToken?: string;
  domainVerifiedAt?: Date;
  /** Ocultar "con tecnología de Sin Humo" (sólo con marca blanca completa). */
  hidePoweredBy: boolean;
  updatedAt: Date;
  updatedBy: string;
}

/** Lo que llega a los renderers para dibujar la marca. */
export interface BrandMark {
  name: string;
  color?: string;
  logoUrl?: string;
  poweredBy: boolean;
  footer?: string;
  emailFromName?: string;
}

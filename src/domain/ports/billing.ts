import type { BillingSubject, Plan, Subscription, UsageEvent, UsageMetric } from "../model";

export interface IPlanRepository {
  findById(id: string): Promise<Plan | undefined>;
  findAll(): Promise<Plan[]>;
}

export interface IPlanWriter {
  save(plan: Plan): Promise<void>;
}

export interface ISubscriptionRepository {
  /** La suscripción más reciente del sujeto, sin contar las que esperan pago. */
  findCurrent(subject: BillingSubject): Promise<Subscription | undefined>;
  findById(id: string): Promise<Subscription | undefined>;
  save(subscription: Subscription): Promise<void>;
  /** Todas (para métricas del negocio). Con muchos clientes conviene una vista materializada. */
  findAll(): Promise<Subscription[]>;
  /** Cuántas vigentes (activas, en prueba o con pago atrasado) tiene un plan. */
  countLive(planId: string): Promise<number>;
  /** Vigentes cuyo período ya terminó (para vencerlas). */
  findDue(now: Date, limit: number): Promise<Subscription[]>;
}

/**
 * Cobros recurrentes del proveedor (débito automático de Mercado Pago, Stripe…). Aparte de
 * IPaymentGateway porque no todos los proveedores los tienen (ISP).
 */
export interface IRecurringCharges {
  /** Que no se cobre más (la persona canceló). */
  stop(subscription: Subscription): Promise<void>;
  /** Que se vuelva a cobrar (deshizo la cancelación antes de que venza). */
  resume(subscription: Subscription): Promise<void>;
}

export interface IUsageRepository {
  count(subjectId: string, metric: UsageMetric, since: Date): Promise<number>;
  record(event: UsageEvent): Promise<void>;
}

/** Cobro: Mercado Pago, Stripe, etc. El sistema sólo conoce esta interfaz. */
export interface IPaymentGateway {
  createCheckout(subscription: Subscription, plan: Plan): Promise<{ checkoutUrl: string }>;
}

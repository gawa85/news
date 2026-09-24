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
}

export interface IUsageRepository {
  count(subjectId: string, metric: UsageMetric, since: Date): Promise<number>;
  record(event: UsageEvent): Promise<void>;
}

/** Cobro: Mercado Pago, Stripe, etc. El sistema sólo conoce esta interfaz. */
export interface IPaymentGateway {
  createCheckout(subscription: Subscription, plan: Plan): Promise<{ checkoutUrl: string }>;
}

import type { AlertHit, AlertRule, AlertTrigger, BillingSubject, SavedRuleSet } from "../model";

export interface IRuleSetRepository {
  findActiveFor(owners: BillingSubject[]): Promise<SavedRuleSet[]>;
  countFor(owner: BillingSubject): Promise<number>;
  findByOwner(owner: BillingSubject): Promise<SavedRuleSet[]>;
  save(ruleSet: SavedRuleSet): Promise<void>;
  deleteByOwner(owner: BillingSubject): Promise<void>;
}

export interface IAlertRuleRepository {
  findByUser(userId: string): Promise<AlertRule[]>;
  findActiveByTopic(topic: string): Promise<AlertRule[]>;
  countActiveByUser(userId: string): Promise<number>;
  findAllActive(): Promise<AlertRule[]>;
  save(rule: AlertRule): Promise<void>;
  deleteByUser(userId: string): Promise<void>;
}

/**
 * Evalúa UN tipo de alerta. Devuelve qué avisar (o nada) y el estado a recordar
 * para no repetir el mismo aviso. Sumar un disparador = sumar una clase.
 */
export interface IAlertEvaluator {
  readonly trigger: AlertTrigger;
  evaluate(rule: AlertRule, since: Date, now: Date): Promise<{ hit?: AlertHit; state?: Record<string, unknown> }>;
}

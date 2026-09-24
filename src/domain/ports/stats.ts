import type { OpenDatasetInfo, Period, ReportSchedule, StatCounter, StatMetric, StatScope } from "../model";

export interface StatKey {
  day: string;
  scope: StatScope;
  scopeId: string;
  metric: StatMetric;
  dim?: string;
}

export interface IStatsRepository {
  /** Suma de forma segura aunque varios servidores sumen a la vez. Devuelve el valor nuevo. */
  increment(key: StatKey, by?: number): Promise<number>;
  find(filter: { scope: StatScope; scopeId: string; metrics?: StatMetric[]; fromDay: string; toDay: string }): Promise<StatCounter[]>;
  /**
   * Registra que una persona (id ya seudonimizado) aportó a un grupo.
   * Devuelve true si es la primera vez: así se cuentan personas DISTINTAS por grupo.
   */
  addContributor(groupKey: string, pseudonym: string): Promise<boolean>;
  contributors(groupKey: string): Promise<number>;
  deleteScope(scope: StatScope, scopeId: string): Promise<void>;
}

/**
 * ANONIMATO de lo que se publica: cada grupo necesita un mínimo de personas distintas
 * (k-anonimato) y los números se redondean. Reemplazable por privacidad diferencial.
 */
export interface IAnonymizer {
  readonly minGroupSize: number;
  readonly rounding: number;
  /** Seudónimo estable e irreversible (no se puede volver al id original). */
  pseudonym(userId: string): string;
  /** null = el grupo se oculta. */
  publish(count: number, distinctContributors: number): number | null;
}

/**
 * ANALÍTICA DE PRODUCTO externa (PostHog, Mixpanel, GA4…): embudos y retención.
 * Nunca se mandan datos personales: sólo seudónimos y propiedades sin texto.
 */
export interface IProductAnalytics {
  track(event: string, distinctId: string, props?: Record<string, string | number | boolean>): Promise<void>;
}

export interface IReportScheduleRepository {
  findById(id: string): Promise<ReportSchedule | undefined>;
  findByOwner(ownerId: string): Promise<ReportSchedule[]>;
  findDue(now: Date): Promise<ReportSchedule[]>;
  save(s: ReportSchedule): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByOwner(ownerId: string): Promise<void>;
}

/** Un dataset de datos abiertos. Sumar uno = una clase más (OCP). */
export interface IOpenDataset {
  readonly info: OpenDatasetInfo;
  rows(period: Period): Promise<Record<string, string | number | null>[]>;
}

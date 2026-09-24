import type { CostEvent } from "../model";

/** Caché con vencimiento (memoria, Redis…). */
export interface ICache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

/** Métricas técnicas (Prometheus, OpenTelemetry, un servicio de monitoreo…). */
export interface IMetrics {
  increment(name: string, labels?: Record<string, string>, value?: number): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
}

/** Contexto del pedido en curso (quién, para qué), sin pasarlo por parámetro a cada capa. */
export interface RequestInfo {
  userId: string;
  subjectId: string;
  action: string;
}

export interface IRequestContext {
  run<T>(info: RequestInfo, fn: () => Promise<T>): Promise<T>;
  current(): RequestInfo | undefined;
}

export interface ICostRepository {
  record(event: CostEvent): Promise<void>;
  findBetween(from: Date, to: Date): Promise<CostEvent[]>;
}

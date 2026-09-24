/**
 * Adaptadores de observabilidad y rendimiento: contexto del pedido, caché, métricas
 * y decoradores que miden costos sin que el código original lo sepa.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { SmokeAnalysis } from "../../domain/model";
import type { DeliveryResult, OutboundMessage } from "../../domain/model";
import type { ICache, IClock, IMessageSender, IMetrics, IRequestContext, ISmokeDetector, RequestInfo } from "../../domain/ports";
import type { CostTracker } from "../../application/costs/Costs";
import type { ILLMClient, LLMRequest, LLMUsage } from "../llm/ILLMClient";
import { normalize } from "../heuristics/text";

export class AsyncRequestContext implements IRequestContext {
  private readonly storage = new AsyncLocalStorage<RequestInfo>();
  run<T>(info: RequestInfo, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(info, fn);
  }
  current(): RequestInfo | undefined {
    return this.storage.getStore();
  }
}

/** Caché en memoria con vencimiento y tope de entradas (para varias instancias: Redis con la misma interfaz). */
export class MemoryTtlCache implements ICache {
  private readonly items = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly clock: IClock,
    private readonly maxEntries = 10_000,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const it = this.items.get(key);
    if (!it) return undefined;
    if (it.expiresAt <= this.clock.now().getTime()) {
      this.items.delete(key);
      return undefined;
    }
    return structuredClone(it.value) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (this.items.size >= this.maxEntries) this.items.delete(this.items.keys().next().value!);
    this.items.set(key, { value: structuredClone(value), expiresAt: this.clock.now().getTime() + ttlSeconds * 1000 });
  }
}

/**
 * Detector de humo con caché: si mil personas reenvían la MISMA cadena, se analiza una vez.
 * La clave es el texto normalizado (mayúsculas, tildes y espacios no importan).
 */
export class CachedSmokeDetector implements ISmokeDetector {
  get version() {
    return this.inner.version;
  }

  constructor(
    private readonly inner: ISmokeDetector,
    private readonly cache: ICache,
    private readonly metrics: IMetrics,
    private readonly ttlSeconds = 24 * 3600,
  ) {}

  async analyze(text: string): Promise<SmokeAnalysis> {
    const key = `smoke:${this.inner.version ?? "sin-version"}:${createHash("sha256").update(normalize(text).replace(/\s+/g, " ").trim()).digest("hex")}`;
    const hit = await this.cache.get<SmokeAnalysis>(key);
    this.metrics.increment("sinhumo_cache_total", { cache: "smoke", result: hit ? "hit" : "miss" });
    if (hit) return hit;
    const r = await this.inner.analyze(text);
    await this.cache.set(key, r, this.ttlSeconds);
    return r;
  }
}

/** Cliente de IA que registra los tokens usados y su costo. */
export class MeteredLLMClient implements ILLMClient {
  constructor(
    private readonly inner: ILLMClient,
    private readonly costs: CostTracker,
  ) {}

  async completeJSON<T>(req: LLMRequest): Promise<{ data: T; usage?: LLMUsage }> {
    const r = await this.inner.completeJSON<T>(req);
    if (r.usage) await this.costs.llm(r.usage.model, r.usage.inputTokens, r.usage.outputTokens);
    return r;
  }
}

/** Sender que registra el costo de cada mensaje efectivamente enviado. */
export class CostRecordingSender implements IMessageSender {
  constructor(
    private readonly inner: IMessageSender,
    private readonly costs: CostTracker,
  ) {}

  get channel() {
    return this.inner.channel;
  }

  async send(msg: OutboundMessage): Promise<DeliveryResult> {
    const r = await this.inner.send(msg);
    if (r.ok) await this.costs.message(this.inner.channel);
    return r;
  }
}

/** Métricas en formato Prometheus (texto), sin dependencias. */
export class PrometheusMetrics implements IMetrics {
  private readonly counters = new Map<string, number>();
  private readonly histos = new Map<string, { buckets: number[]; counts: number[]; sum: number; count: number }>();
  private static readonly BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

  increment(name: string, labels: Record<string, string> = {}, value = 1): void {
    const k = key(name, labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + value);
  }

  observe(name: string, value: number, labels: Record<string, string> = {}): void {
    const k = key(name, labels);
    const h = this.histos.get(k) ?? { buckets: PrometheusMetrics.BUCKETS, counts: PrometheusMetrics.BUCKETS.map(() => 0), sum: 0, count: 0 };
    h.buckets.forEach((b, i) => { if (value <= b) h.counts[i]!++; });
    h.sum += value;
    h.count++;
    this.histos.set(k, h);
  }

  render(): string {
    const lines: string[] = [];
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, h] of this.histos) {
      const [name, labels] = splitKey(k);
      h.buckets.forEach((b, i) => lines.push(`${name}_bucket${withLabel(labels, `le="${b}"`)} ${h.counts[i]}`));
      lines.push(`${name}_bucket${withLabel(labels, 'le="+Inf"')} ${h.count}`);
      lines.push(`${name}_sum${labels} ${h.sum}`);
      lines.push(`${name}_count${labels} ${h.count}`);
    }
    return `${lines.join("\n")}\n`;
  }

  value(name: string, labels: Record<string, string> = {}): number {
    return this.counters.get(key(name, labels)) ?? 0;
  }
}

export class NoopMetrics implements IMetrics {
  increment(): void {}
  observe(): void {}
}

function key(name: string, labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return entries.length ? `${name}{${entries.map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(",")}}` : name;
}

function splitKey(k: string): [string, string] {
  const i = k.indexOf("{");
  return i < 0 ? [k, ""] : [k.slice(0, i), k.slice(i)];
}

function withLabel(labels: string, extra: string): string {
  return labels ? `${labels.slice(0, -1)},${extra}}` : `{${extra}}`;
}

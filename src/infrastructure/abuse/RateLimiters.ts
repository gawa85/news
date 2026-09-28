/**
 * Límites de frecuencia por ventana fija. Dos adaptadores del mismo puerto:
 *  - en la base (por defecto): atómico y compartido entre servidores;
 *  - en memoria: para un solo proceso (tests, desarrollo) o como capa rápida delante.
 */
import type { IRateCounterRepository, IRateLimiter } from "../../domain/ports";

function window(at: Date, windowSeconds: number) {
  const ms = windowSeconds * 1000;
  const start = Math.floor(at.getTime() / ms) * ms;
  return { start: new Date(start), end: new Date(start + ms) };
}

export class StoreRateLimiter implements IRateLimiter {
  constructor(private readonly counters: IRateCounterRepository) {}

  async consume(key: string, limit: number, windowSeconds: number, at: Date) {
    const w = window(at, windowSeconds);
    const count = await this.counters.increment(key, w.start, w.end);
    return { allowed: count <= limit, count, retryAfterSeconds: count <= limit ? 0 : Math.ceil((w.end.getTime() - at.getTime()) / 1000) };
  }
}

export class MemoryRateLimiter implements IRateLimiter {
  private readonly counts = new Map<string, { count: number; end: number }>();

  async consume(key: string, limit: number, windowSeconds: number, at: Date) {
    const w = window(at, windowSeconds);
    const id = `${key}|${w.start.getTime()}`;
    const cur = this.counts.get(id) ?? { count: 0, end: w.end.getTime() };
    cur.count++;
    this.counts.set(id, cur);
    // Limpieza oportunista de ventanas vencidas.
    if (this.counts.size > 10_000) for (const [k, v] of this.counts) if (v.end <= at.getTime()) this.counts.delete(k);
    return { allowed: cur.count <= limit, count: cur.count, retryAfterSeconds: cur.count <= limit ? 0 : Math.ceil((cur.end - at.getTime()) / 1000) };
  }
}

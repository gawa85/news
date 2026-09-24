import { randomUUID } from "node:crypto";
import type { IClock, IIdGenerator, ILogger } from "../../domain/ports";

export class SystemClock implements IClock {
  now() {
    return new Date();
  }
}

export class FixedClock implements IClock {
  constructor(private readonly date: Date) {}
  now() {
    return this.date;
  }
}

/** Ids únicos globales (producción): "user_3f9a…". */
export class RandomIdGenerator implements IIdGenerator {
  next(prefix: string) {
    return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  }
}

/** Ids legibles y predecibles (demo): "user-1", "user-2"... */
export class SequentialIdGenerator implements IIdGenerator {
  private counters = new Map<string, number>();
  next(prefix: string) {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }
}

export class ConsoleLogger implements ILogger {
  constructor(private readonly verbose = false) {}
  info(m: string, meta?: Record<string, unknown>) {
    if (this.verbose) console.log(`[info] ${m}`, meta ?? "");
  }
  warn(m: string, meta?: Record<string, unknown>) {
    console.warn(`[warn] ${m}`, meta ?? "");
  }
  error(m: string, meta?: Record<string, unknown>) {
    console.error(`[error] ${m}`, meta ?? "");
  }
}

export class SilentLogger implements ILogger {
  info() {}
  warn() {}
  error() {}
}

/** Reloj controlable (tests y demo): se puede adelantar el tiempo. */
export class ManualClock implements IClock {
  constructor(private current: Date) {}
  now() {
    return new Date(this.current);
  }
  set(d: Date) {
    this.current = new Date(d);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

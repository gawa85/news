import { randomUUID } from "node:crypto";
import { ConflictError } from "../../domain/errors";
import type { Job, RecurringSchedule } from "../../domain/model";
import type { EnqueueOptions, IClock, IJobQueue, IJobRepository, ILogger, JobHandler } from "../../domain/ports";

/** Cola persistente sobre la base de datos (cualquier motor que implemente IJobRepository). */
export class PersistentJobQueue implements IJobQueue {
  constructor(
    private readonly jobs: IJobRepository,
    private readonly clock: IClock,
  ) {}

  async enqueue(type: string, payload: Record<string, unknown>, opts: EnqueueOptions = {}): Promise<Job | undefined> {
    const now = this.clock.now();
    const job: Job = {
      id: opts.dedupeKey ?? `job_${randomUUID()}`,
      type,
      payload,
      status: "queued",
      runAt: opts.runAt ?? now,
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 5,
      createdAt: now,
    };
    try {
      await this.jobs.insert(job);
      return job;
    } catch (err) {
      if (err instanceof ConflictError) return undefined; // ya encolado por otro servidor
      throw err;
    }
  }
}

export interface WorkerOptions {
  workerId: string;
  batchSize: number;
  /** Cuánto tiempo "reserva" un trabajo. Si el servidor se cae, otro lo retoma al vencer. */
  leaseMs: number;
  backoffBaseMs: number;
  maxBackoffMs: number;
}

/**
 * Ejecuta trabajos.
 * REGLAS:
 *  - Reclamo atómico: dos servidores nunca corren el mismo trabajo a la vez.
 *  - Si falla: reintento con espera creciente (1, 2, 4, 8… min) hasta el máximo;
 *    después queda "muerto" (cola de revisión), con el último error.
 *  - Tipo desconocido → muerto de inmediato (no tiene sentido reintentar).
 *  - Trabajos de un servidor que se cayó se retoman cuando vence su reserva.
 */
export class JobWorker {
  private readonly opts: WorkerOptions;

  constructor(
    private readonly jobs: IJobRepository,
    private readonly handlers: Record<string, JobHandler>,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    opts: Partial<WorkerOptions> = {},
  ) {
    this.opts = { workerId: `worker_${randomUUID().slice(0, 8)}`, batchSize: 10, leaseMs: 5 * 60_000, backoffBaseMs: 60_000, maxBackoffMs: 6 * 3_600_000, ...opts };
  }

  /** Reclama y corre un lote. Devuelve cuántos corrió. */
  async runOnce(): Promise<{ ran: number; failed: number; dead: number }> {
    const claimed = await this.claim();
    let failed = 0;
    let dead = 0;
    for (const job of claimed) {
      const handler = this.handlers[job.type];
      try {
        if (!handler) throw new UnknownJobType(job.type);
        await handler(job.payload, job);
        await this.finish(job, { ...job, status: "done", finishedAt: this.clock.now(), lockedBy: undefined, lockedUntil: undefined });
      } catch (err) {
        const attempts = job.attempts + 1;
        const giveUp = err instanceof UnknownJobType || attempts >= job.maxAttempts;
        const wait = Math.min(this.opts.maxBackoffMs, this.opts.backoffBaseMs * 2 ** (attempts - 1));
        const now = this.clock.now();
        await this.finish(job, {
          ...job,
          attempts,
          status: giveUp ? "dead" : "queued",
          runAt: giveUp ? job.runAt : new Date(now.getTime() + wait),
          lastError: err instanceof Error ? err.message : String(err),
          finishedAt: giveUp ? now : undefined,
          lockedBy: undefined,
          lockedUntil: undefined,
        });
        if (giveUp) dead++;
        else failed++;
        this.logger.warn("Falló un trabajo", { type: job.type, id: job.id, attempts, giveUp });
      }
    }
    return { ran: claimed.length, failed, dead };
  }

  private async claim(): Promise<Job[]> {
    const now = this.clock.now();
    const candidates = [...(await this.jobs.findExpiredLeases(now, this.opts.batchSize)), ...(await this.jobs.findDue(now, this.opts.batchSize))];
    const mine: Job[] = [];
    for (const job of candidates) {
      if (mine.length >= this.opts.batchSize) break;
      const claimed: Job = { ...job, status: "running", lockedBy: this.opts.workerId, lockedUntil: new Date(now.getTime() + this.opts.leaseMs) };
      // Sólo gana quien lo encuentra en el MISMO estado en que lo vio.
      const ok = await this.jobs.replaceIf(claimed, { status: job.status, lockedBy: job.lockedBy ?? null });
      if (ok) mine.push(claimed);
    }
    return mine;
  }

  private async finish(running: Job, next: Job): Promise<void> {
    const ok = await this.jobs.replaceIf(next, { status: "running", lockedBy: running.lockedBy ?? null });
    if (!ok) this.logger.warn("Otro servidor retomó un trabajo que tardó más que su reserva", { id: running.id });
  }
}

class UnknownJobType extends Error {
  constructor(type: string) {
    super(`No hay quien procese trabajos de tipo "${type}".`);
  }
}

/**
 * Planificador de tareas recurrentes. Cada "franja" (p. ej. cada 15 min) genera un
 * trabajo con clave única: aunque corran 5 servidores, la tarea se hace una vez.
 */
export class RecurringScheduler {
  constructor(
    private readonly queue: IJobQueue,
    private readonly schedules: RecurringSchedule[],
    private readonly clock: IClock,
  ) {}

  async tick(): Promise<number> {
    const now = this.clock.now().getTime();
    let created = 0;
    for (const s of this.schedules) {
      const slotMs = s.everyMinutes * 60_000;
      const slot = Math.floor(now / slotMs) * slotMs;
      const job = await this.queue.enqueue(s.jobType, s.payload ?? {}, { dedupeKey: `${s.name}@${new Date(slot).toISOString()}`, runAt: new Date(slot), maxAttempts: 3 });
      if (job) created++;
    }
    return created;
  }
}

import type { Job, JobStatus } from "../model";

export interface IJobRepository {
  /** Inserta; ConflictError si ya existe ese id (deduplicación). */
  insert(job: Job): Promise<void>;
  findById(id: string): Promise<Job | undefined>;
  /** Trabajos listos para correr: en cola y con fecha cumplida. */
  findDue(now: Date, limit: number): Promise<Job[]>;
  /** Trabajos "corriendo" cuyo servidor dejó de renovarlos (se cayó). */
  findExpiredLeases(now: Date, limit: number): Promise<Job[]>;
  /** Reemplaza sólo si sigue en el estado esperado (reclamo atómico). */
  replaceIf(job: Job, expected: { status: JobStatus; lockedBy?: string | null }): Promise<boolean>;
  countByStatus(status: JobStatus): Promise<number>;
  deleteFinishedBefore(date: Date): Promise<void>;
}

export interface EnqueueOptions {
  runAt?: Date;
  maxAttempts?: number;
  /** Mismo valor = mismo trabajo: no se duplica (p. ej. "sync:2026-09-23T15:15"). */
  dedupeKey?: string;
}

export interface IJobQueue {
  enqueue(type: string, payload: Record<string, unknown>, opts?: EnqueueOptions): Promise<Job | undefined>;
}

export type JobHandler = (payload: Record<string, unknown>, job: Job) => Promise<void>;

/**
 * TRABAJOS EN SEGUNDO PLANO: sincronizar fuentes, evaluar alertas, medir impacto,
 * aplicar retención, mandar resúmenes… Persisten en la base: si el servidor se cae,
 * no se pierden; con varios servidores, cada trabajo lo hace UNO solo.
 */
export type JobStatus = "queued" | "running" | "done" | "dead";

export interface Job {
  /** Si tiene clave de deduplicación, el id ES esa clave (no se encola dos veces). */
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  runAt: Date;
  attempts: number;
  maxAttempts: number;
  lockedBy?: string;
  lockedUntil?: Date;
  lastError?: string;
  createdAt: Date;
  finishedAt?: Date;
}

/** Tarea recurrente: "cada N minutos, encolá un trabajo de tipo X". */
export interface RecurringSchedule {
  name: string;
  jobType: string;
  everyMinutes: number;
  payload?: Record<string, unknown>;
}

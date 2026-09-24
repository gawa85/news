/** Hasta el reloj es una interfaz: así los tests controlan "la fecha de hoy". */
export interface IClock {
  now(): Date;
}

export interface IIdGenerator {
  next(prefix: string): string;
}

export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

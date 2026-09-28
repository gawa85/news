import type { AbuseContext, AbuseSignal, AbuseTarget, Restriction } from "../model";

/**
 * Límite de frecuencia por ventana fija. Suma y controla en un solo paso (atómico: con
 * varios servidores, dos pedidos simultáneos no pueden pasar ambos el último lugar).
 */
export interface IRateLimiter {
  consume(key: string, limit: number, windowSeconds: number, at: Date): Promise<{ allowed: boolean; count: number; retryAfterSeconds: number }>;
}

/** Verificación de captcha (Turnstile, hCaptcha, reCAPTCHA…). */
export interface ICaptchaVerifier {
  readonly id: string;
  verify(token: string, ip?: string): Promise<{ ok: boolean; error?: string }>;
}

/**
 * Una señal de abuso (mail descartable, muchas cuentas desde una red, cliente automatizado…).
 * Sumar una señal nueva = otra clase (OCP); el guardián las combina.
 */
export interface IAbuseSignalProvider {
  readonly id: string;
  inspect(ctx: AbuseContext): Promise<AbuseSignal[]>;
}

/** Contadores por ventana, atómicos (los usa el limitador que guarda en la base). */
export interface IRateCounterRepository {
  /** Suma uno al contador de esa clave y ventana; devuelve el total. */
  increment(key: string, windowStart: Date, expiresAt: Date): Promise<number>;
  deleteExpired(now: Date): Promise<void>;
}

export interface IRestrictionRepository {
  save(r: Restriction): Promise<void>;
  findById(id: string): Promise<Restriction | undefined>;
  /** Las vigentes (no levantadas y sin vencer) sobre alguno de esos destinos. */
  findActive(targets: AbuseTarget[], now: Date): Promise<Restriction[]>;
  findRecent(limit: number): Promise<Restriction[]>;
}

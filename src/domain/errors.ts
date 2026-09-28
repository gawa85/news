export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {}
export class NotFoundError extends DomainError {}
export class InsufficientDataError extends DomainError {}

/** Acceso denegado por una regla de negocio. Lleva el código y, si aplica, un plan sugerido. */
export class AccessDeniedError extends DomainError {
  constructor(
    message: string,
    readonly code: string,
    readonly upgradeHint?: string,
  ) {
    super(message);
  }
}

export class ConflictError extends DomainError {}

/**
 * Freno contra el abuso: demasiados pedidos ("too_many_attempts", con cuándo reintentar)
 * o hace falta resolver un captcha ("captcha_required").
 */
export class AbuseRejectedError extends AccessDeniedError {
  constructor(
    message: string,
    code: "too_many_attempts" | "captcha_required" | "restricted",
    readonly retryAfterSeconds?: number,
  ) {
    super(message, code);
  }
}

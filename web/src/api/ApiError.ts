/**
 * Error de la API, con lo que la pantalla necesita para explicarlo bien:
 * el código (cupo agotado, captcha, plan), la sugerencia de plan y cuándo reintentar.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly upgradeHint?: string,
    readonly retryAfterSeconds?: number,
    readonly captcha?: { provider: string; siteKey: string },
  ) {
    super(message);
    this.name = "ApiError";
  }

  get needsLogin(): boolean {
    return this.status === 403 && this.code === "no_permission" && /sesión|clave de API/i.test(this.message);
  }

  get needsCaptcha(): boolean {
    return this.code === "captcha_required";
  }

  get isLimit(): boolean {
    return this.status === 429;
  }

  get needsBetterPlan(): boolean {
    return this.code === "feature_not_in_plan" || this.code === "quota_exceeded" || this.code === "limit_exceeded";
  }
}

/** Mensaje para una persona, a partir de cualquier error. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return "No hay conexión con Sin Humo. Revisá tu internet y probá de nuevo.";
  return "Algo salió mal. Probá de nuevo en un rato.";
}

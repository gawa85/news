/**
 * Adaptadores de estadísticas: anonimato para lo público y analítica de producto externa.
 */
import { createHmac } from "node:crypto";
import type { IAnonymizer, IHttpClient, ILogger, IProductAnalytics } from "../../domain/ports";

/**
 * k-ANONIMATO + REDONDEO.
 *  - Un grupo (un tema, un tipo de humo, un canal) sólo se publica si lo aportaron al
 *    menos `minGroupSize` personas distintas: así nadie queda identificado por un tema raro.
 *  - Los números se redondean (de a 5 por defecto) para no revelar altas y bajas individuales
 *    comparando dos días seguidos.
 *  - El seudónimo es un HMAC con una clave secreta: no se puede volver al id original
 *    y cambia si se rota la clave.
 */
export class KAnonymizer implements IAnonymizer {
  constructor(
    private readonly secret: string,
    readonly minGroupSize = 10,
    readonly rounding = 5,
  ) {
    if (secret.length < 16) throw new Error("La clave del seudonimizador tiene que tener al menos 16 caracteres.");
  }

  pseudonym(userId: string): string {
    return createHmac("sha256", this.secret).update(userId).digest("base64url").slice(0, 22);
  }

  publish(count: number, distinctContributors: number): number | null {
    if (distinctContributors < this.minGroupSize) return null;
    return Math.max(this.rounding, Math.round(count / this.rounding) * this.rounding);
  }
}

/** PostHog (en la nube o instalado propio). Mixpanel/GA4 serían otra clase igual. */
export class PostHogProductAnalytics implements IProductAnalytics {
  constructor(
    private readonly http: IHttpClient,
    private readonly cfg: { host: string; apiKey: string },
    private readonly logger: ILogger,
  ) {}

  async track(event: string, distinctId: string, props: Record<string, string | number | boolean> = {}): Promise<void> {
    try {
      const res = await this.http.send("POST", `${this.cfg.host.replace(/\/$/, "")}/capture/`, { api_key: this.cfg.apiKey, event, distinct_id: distinctId, properties: props });
      if (res.status >= 300) this.logger.warn("Analítica: respuesta inesperada", { status: res.status });
    } catch (err) {
      // La analítica nunca puede romper el producto.
      this.logger.warn("Analítica: no se pudo enviar", { error: String(err) });
    }
  }
}

export class NoopProductAnalytics implements IProductAnalytics {
  async track(): Promise<void> {}
}

/** Para tests: guarda lo que se habría mandado. */
export class RecordingProductAnalytics implements IProductAnalytics {
  readonly events: { event: string; distinctId: string; props: Record<string, string | number | boolean> }[] = [];
  async track(event: string, distinctId: string, props: Record<string, string | number | boolean> = {}): Promise<void> {
    this.events.push({ event, distinctId, props });
  }
}

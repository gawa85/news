import { createHmac } from "node:crypto";
import type { DomainEvent } from "../../domain/model";
import type { IEventBus, IHttpClient, ILogger, ISecretVault, IWebhookRepository } from "../../domain/ports";

/**
 * Envía los eventos del dominio a los webhooks registrados.
 * Firma: `x-sinhumo-signature: sha256=HMAC(secreto, "<timestamp>.<cuerpo>")`.
 * El receptor debe verificar la firma y rechazar timestamps viejos (evita repeticiones).
 */
export class WebhookDispatcher {
  constructor(
    private readonly webhooks: IWebhookRepository,
    private readonly vault: ISecretVault,
    private readonly http: IHttpClient,
    private readonly logger: ILogger,
    private readonly retries = 1,
  ) {}

  attach(bus: IEventBus): void {
    bus.subscribe((e) => this.dispatch(e));
  }

  async dispatch(event: DomainEvent): Promise<void> {
    const subs = await this.webhooks.findActiveForEvent(event.userId, event.type);
    for (const sub of subs) {
      const secret = await this.vault.get(sub.secretRef);
      if (!secret) continue;
      const body = JSON.stringify({ id: event.id, type: event.type, occurredAt: event.occurredAt, data: event.data });
      const ts = Math.floor(event.occurredAt.getTime() / 1000).toString();
      const headers = {
        "content-type": "application/json",
        "x-sinhumo-event": event.type,
        "x-sinhumo-timestamp": ts,
        "x-sinhumo-signature": `sha256=${signWebhook(secret, ts, body)}`,
      };
      let ok = false;
      for (let attempt = 0; attempt <= this.retries && !ok; attempt++) {
        try {
          const res = await this.http.send("POST", sub.url, body, headers);
          ok = res.status >= 200 && res.status < 300;
        } catch {
          ok = false;
        }
      }
      if (!ok) this.logger.warn("No se pudo entregar un webhook", { webhookId: sub.id, event: event.type });
    }
  }
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

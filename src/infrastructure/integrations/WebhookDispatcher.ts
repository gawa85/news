import { createHmac } from "node:crypto";
import type { DomainEvent, WebhookSubscription } from "../../domain/model";
import type { IClock, IEventBus, IHttpClient, ILogger, ISecretVault, IWebhookDelivery, IWebhookRepository } from "../../domain/ports";

/**
 * Envía los eventos del dominio a los webhooks registrados.
 * Firma: `x-sinhumo-signature: sha256=HMAC(secreto, "<timestamp>.<cuerpo>")`.
 * El receptor debe verificar la firma y rechazar timestamps viejos (evita repeticiones).
 * Cada envío queda registrado en el webhook (`lastDelivery`) para verlo desde la web.
 * El cliente HTTP lo elige la composición (en producción, sólo destinos públicos).
 */
export class WebhookDispatcher implements IWebhookDelivery {
  constructor(
    private readonly webhooks: IWebhookRepository,
    private readonly vault: ISecretVault,
    private readonly http: IHttpClient,
    private readonly logger: ILogger,
    private readonly clock: IClock,
    private readonly retries = 1,
  ) {}

  attach(bus: IEventBus): void {
    bus.subscribe((e) => this.dispatch(e));
  }

  async dispatch(event: DomainEvent): Promise<void> {
    for (const sub of await this.webhooks.findActiveForEvent(event.userId, event.type)) {
      const r = await this.deliver(sub, event);
      if (!r.ok) this.logger.warn("No se pudo entregar un webhook", { webhookId: sub.id, event: event.type, status: r.status, error: r.error });
    }
  }

  async deliver(sub: WebhookSubscription, event: { id: string; type: string; occurredAt: Date; data: Record<string, unknown> }) {
    const secret = await this.vault.get(sub.secretRef);
    if (!secret) return { ok: false, error: "Falta el secreto de firma." };
    const body = JSON.stringify({ id: event.id, type: event.type, occurredAt: event.occurredAt, data: event.data });
    const ts = Math.floor(event.occurredAt.getTime() / 1000).toString();
    const headers = {
      "content-type": "application/json",
      "x-sinhumo-event": event.type,
      "x-sinhumo-timestamp": ts,
      "x-sinhumo-signature": `sha256=${signWebhook(secret, ts, body)}`,
    };
    let result: { ok: boolean; status?: number; error?: string } = { ok: false };
    for (let attempt = 0; attempt <= this.retries && !result.ok; attempt++) {
      try {
        const res = await this.http.send("POST", sub.url, body, headers);
        result = { ok: res.status >= 200 && res.status < 300, status: res.status, ...(res.status >= 300 ? { error: `Respondió HTTP ${res.status}.` } : {}) };
      } catch (e) {
        result = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    const latest = (await this.webhooks.findByUser(sub.userId)).find((w) => w.id === sub.id) ?? sub;
    await this.webhooks.save({ ...latest, lastDelivery: { at: this.clock.now(), ...result } });
    return result;
  }
}

export function signWebhook(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

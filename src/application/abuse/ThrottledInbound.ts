import type { InboundMessage } from "../../domain/model";
import type { IClock, IRateLimiter } from "../../domain/ports";
import type { ResponseComposer } from "../messaging/ResponseComposer";
import type { NotificationService } from "../messaging/NotificationService";
import type { IAbusePolicy } from "./AbuseGuard";

/** Lo que entra por un canal de chat (el caso de uso real o este freno delante). */
export interface IInboundHandler {
  execute(msg: InboundMessage): Promise<unknown>;
}

/** Un aviso de "vas muy rápido" cada tanto, no uno por mensaje (cada respuesta se paga). */
const NOTICE_EVERY_SECONDS = 600;

/**
 * FRENO DEL CHAT (decorador): antes de crear la cuenta o responder, controla la frecuencia
 * de esa dirección. Con exceso: un solo aviso por ventana y después silencio. Bloqueada:
 * silencio (responderle también cuesta y le confirma al spammer que el número atiende).
 */
export class ThrottledInbound implements IInboundHandler {
  constructor(
    private readonly inner: IInboundHandler,
    private readonly guard: IAbusePolicy,
    private readonly limiter: IRateLimiter,
    private readonly notifications: NotificationService,
    private readonly composer: ResponseComposer,
    private readonly clock: IClock,
  ) {}

  async execute(msg: InboundMessage): Promise<unknown> {
    const now = this.clock.now();
    const address = `${msg.channel}:${msg.from}`;
    const d = await this.guard.check({ action: "inbound_message", at: now, address });
    if (d.outcome === "allow") return this.inner.execute(msg);
    if (d.signals.some((s) => s.type === "restricted")) return { dropped: "restricted" as const };

    // Aviso de mejor esfuerzo: si el canal lo frena (se le acaba de responder), no se insiste.
    const notice = await this.limiter.consume(`aviso:${address}`, 1, NOTICE_EVERY_SECONDS, now);
    if (notice.allowed) {
      const wait = d.outcome === "deny" && d.retryAfterSeconds ? Math.max(1, Math.ceil(d.retryAfterSeconds / 60)) : 1;
      await this.notifications.sendTo(
        msg.channel,
        msg.from,
        this.composer.info("Vas muy rápido.", `Esperá ${wait === 1 ? "un minuto" : `${wait} minutos`} y volvé a escribirme. Mientras tanto no voy a responder.`),
        "reply",
        { replyTo: { externalId: msg.externalId } },
      );
    }
    return { dropped: "throttled" as const };
  }
}

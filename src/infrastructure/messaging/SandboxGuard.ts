import type { DeliveryResult, OutboundMessage } from "../../domain/model";
import type { ILogger, IMessageSender } from "../../domain/ports";

/**
 * GUARDIA DE AMBIENTE (fuera de producción): sólo se envía a la lista de destinatarios
 * del equipo; a cualquier otra persona NO se le manda nada (se registra como enviado para
 * que las pruebas sigan). Todo lo que sale lleva un prefijo visible ("[PRUEBA]").
 */
export class SandboxGuardSender implements IMessageSender {
  readonly blocked: OutboundMessage[] = [];

  constructor(
    private readonly inner: IMessageSender,
    private readonly allowlist: string[],
    private readonly prefix: string,
    private readonly logger: ILogger,
  ) {}

  get channel() {
    return this.inner.channel;
  }

  async send(msg: OutboundMessage): Promise<DeliveryResult> {
    const to = msg.to.trim().toLowerCase();
    if (!this.allowlist.some((a) => a.trim().toLowerCase() === to)) {
      this.blocked.push(msg);
      this.logger.info("Ambiente de prueba: envío retenido (destinatario fuera de la lista)", { channel: this.inner.channel, to: `${to.slice(0, 4)}…` });
      return { ok: true, providerMessageId: `sandbox-${this.blocked.length}` };
    }
    return this.inner.send({
      ...msg,
      text: `${this.prefix} ${msg.text}`,
      subject: msg.subject ? `${this.prefix} ${msg.subject}` : msg.subject,
      html: msg.html ? `<p><strong>${this.prefix}</strong></p>${msg.html}` : msg.html,
    });
  }
}

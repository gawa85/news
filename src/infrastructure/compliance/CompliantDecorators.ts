/**
 * DECORADORES: envuelven cualquier IMessageSender o IReplyPublisher y le agregan
 * las reglas de cumplimiento, sin que el adaptador original lo sepa (OCP + DIP).
 *
 *   new CompliantMessageSender(new WhatsAppCloudSender(...), guard)
 */
import { ComplianceGuard, outcomeOf } from "../../application/compliance/ComplianceGuard";
import type {
  ChannelType,
  DeliveryResult,
  OutboundMessage,
  PublishResult,
  ReplyTarget,
  ResponseContent,
} from "../../domain/model";
import type { IMessageSender, IReplyPublisher } from "../../domain/ports";

export const BOT_DISCLOSURE = "🤖 Respuesta automática de Sin Humo.";
export const UNSUBSCRIBE_TEXT = "Para no recibir más avisos, respondé BAJA.";

export interface SenderOptions {
  unsubscribeUrl?: string;
  /** Una RESPUESTA frenada por un límite corto (p. ej. 6 s entre mensajes a la misma persona) se demora en vez de perderse. */
  maxReplyWaitMs: number;
  wait: (ms: number) => Promise<void>;
}

const realWait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class CompliantMessageSender implements IMessageSender {
  private readonly opts: SenderOptions;

  constructor(
    private readonly inner: IMessageSender,
    private readonly guard: ComplianceGuard,
    opts: Partial<SenderOptions> = {},
    private readonly now: () => Date = () => new Date(),
  ) {
    this.opts = { maxReplyWaitMs: 10_000, wait: realWait, ...opts };
  }

  get channel(): ChannelType {
    return this.inner.channel;
  }

  async send(msg: OutboundMessage): Promise<DeliveryResult> {
    const ctx = { destination: this.inner.channel, recipient: msg.to, purpose: msg.purpose ?? "reply", isTemplate: !!msg.template };
    let decision = await this.guard.check(ctx);
    if (!decision.allowed && decision.code === "rate_limited" && ctx.purpose === "reply" && decision.retryAt) {
      const waitMs = decision.retryAt.getTime() - this.now().getTime();
      if (waitMs <= this.opts.maxReplyWaitMs) {
        await this.opts.wait(Math.max(0, waitMs));
        decision = await this.guard.check(ctx);
      }
    }
    if (!decision.allowed) {
      await this.guard.record(ctx, "blocked_by_policy", decision.code);
      return { ok: false, error: `${decision.code}: ${decision.message}` };
    }

    let out = msg;
    if (decision.mustDiscloseBot && !msg.template && !msg.text.includes(BOT_DISCLOSURE)) {
      // Con marca blanca, el aviso de bot sigue (es obligatorio) pero con el nombre de la organización.
      const disclosure = out.fromName ? `🤖 Respuesta automática de ${out.fromName}.` : BOT_DISCLOSURE;
      out = { ...out, text: `${out.text}\n\n${disclosure}`, html: out.html && `${out.html}<p><small>${disclosure}</small></p>` };
    }
    if (decision.mustIncludeUnsubscribe) {
      out = {
        ...out,
        text: `${out.text}\n${UNSUBSCRIBE_TEXT}`,
        html: out.html && `${out.html}<p><small>${UNSUBSCRIBE_TEXT}</small></p>`,
        headers: {
          ...out.headers,
          ...(this.opts.unsubscribeUrl ? { "List-Unsubscribe": `<${this.opts.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}),
        },
      };
    }

    const result = await this.inner.send(out);
    await this.guard.record(ctx, outcomeOf(result), result.error ?? (result.httpStatus ? `HTTP ${result.httpStatus}` : undefined));
    return result;
  }
}

export class CompliantReplyPublisher implements IReplyPublisher {
  constructor(
    private readonly inner: IReplyPublisher,
    private readonly guard: ComplianceGuard,
  ) {}

  supports(target: ReplyTarget): boolean {
    return this.inner.supports(target);
  }

  async publish(target: ReplyTarget, content: ResponseContent): Promise<PublishResult> {
    const ctx = { destination: target.destination, recipient: target.ref, purpose: "reply" as const };
    const decision = await this.guard.check(ctx);
    if (!decision.allowed) {
      await this.guard.record(ctx, "blocked_by_policy", decision.code);
      return { ok: false, error: `${decision.code}: ${decision.message}` };
    }
    const disclosed = decision.mustDiscloseBot && !(content.footer ?? "").includes(BOT_DISCLOSURE)
      ? { ...content, footer: [content.footer, BOT_DISCLOSURE].filter(Boolean).join(" ") }
      : content;
    const result = await this.inner.publish(target, disclosed);
    await this.guard.record(ctx, outcomeOf(result), result.error);
    return result;
  }
}

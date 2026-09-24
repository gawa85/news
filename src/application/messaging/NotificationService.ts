import { quietUntil, type BrandMark, type ChannelType, type DeliveryResult, type OutboundMessage, type ResponseContent, type SendPurpose, type User } from "../../domain/model";
import type { IClock, IJobQueue, IPreferencesReader } from "../../domain/ports";
import type { ChannelRegistry } from "./ChannelRegistry";

/** Preferencias: horario de silencio (los avisos se postergan) y orden de canales. */
export interface NotificationPreferences {
  reader: IPreferencesReader;
  queue: IJobQueue;
  clock: IClock;
  /** Marca de la organización del destinatario (marca blanca). */
  brand?: (user: User) => Promise<BrandMark | undefined>;
}

export const DEFERRED_NOTIFICATION_JOB = "deliver_notification";

/**
 * Envía una respuesta neutra por un canal: la dibuja con el renderer del canal
 * y la manda con su sender (que ya viene envuelto con las reglas de cumplimiento).
 */
export class NotificationService {
  constructor(
    private readonly channels: ChannelRegistry,
    private prefs?: NotificationPreferences,
  ) {}

  /** Se conecta después de armar las preferencias (evita dependencias circulares al componer). */
  usePreferences(p: NotificationPreferences): void {
    this.prefs = p;
  }

  async sendTo(
    channel: ChannelType,
    address: string,
    content: ResponseContent,
    purpose: SendPurpose,
    extra: Partial<OutboundMessage> = {},
  ): Promise<DeliveryResult> {
    const msg = this.channels.renderer(channel).render(content, address);
    return this.channels.sender(channel).send({ ...msg, ...extra, purpose });
  }

  /**
   * Avisar a un usuario por su canal preferido; si no se puede, por otro canal verificado.
   * `allowed`: canales que habilita su plan.
   */
  async notifyUser(
    user: User,
    content: ResponseContent,
    allowed: ChannelType[],
    /** Plantilla para WhatsApp (obligatoria fuera de la ventana de 24 h). */
    whatsappTemplate?: OutboundMessage["template"],
    opts: { ignoreQuietHours?: boolean } = {},
  ): Promise<DeliveryResult & { channel?: ChannelType; deferredUntil?: Date }> {
    const prefs = this.prefs ? await this.prefs.reader.effective(user) : undefined;
    // Horario de silencio: el aviso no se pierde, se manda cuando termina.
    const until = prefs && !opts.ignoreQuietHours ? quietUntil(prefs.quietHours, this.prefs!.clock.now()) : undefined;
    if (until) {
      await this.prefs!.queue.enqueue(DEFERRED_NOTIFICATION_JOB, { userId: user.id, content: content as never, allowed, whatsappTemplate: whatsappTemplate as never }, { runAt: until });
      return { ok: true, deferredUntil: until };
    }
    const brand = await this.prefs?.brand?.(user);
    if (brand) content = { ...content, brand };
    const verified = user.channels.filter((c) => c.verified && allowed.includes(c.channel) && this.channels.canSend(c.channel));
    const rank = (ch: ChannelType) => {
      const i = prefs?.notifyChannels.indexOf(ch) ?? -1;
      return i >= 0 ? i : ch === user.preferredChannel ? 100 : 200;
    };
    const ordered = [...verified].sort((a, b) => rank(a.channel) - rank(b.channel));
    let last: DeliveryResult = { ok: false, error: "El usuario no tiene canales verificados habilitados." };
    for (const c of ordered) {
      last = await this.sendTo(c.channel, c.address, content, "notification", c.channel === "whatsapp" && whatsappTemplate ? { template: whatsappTemplate } : {});
      if (last.ok) return { ...last, channel: c.channel };
    }
    // Límite por destinatario (se le escribió hace muy poco): el aviso no se pierde, se reintenta en un minuto.
    if (this.prefs && last.error?.startsWith("rate_limited")) {
      const at = new Date(this.prefs.clock.now().getTime() + 60_000);
      await this.prefs.queue.enqueue(DEFERRED_NOTIFICATION_JOB, { userId: user.id, content: content as never, allowed, whatsappTemplate: whatsappTemplate as never }, { runAt: at });
      return { ok: true, deferredUntil: at };
    }
    return last;
  }
}

/**
 * Adaptadores de CANAL: parsers de webhooks entrantes y senders salientes.
 * Formatos según las APIs oficiales: WhatsApp Business Cloud API y Telegram Bot API.
 */
import type { ChannelType, DeliveryResult, InboundMessage, OutboundMessage } from "../../domain/model";
import type { EmailEnvelope, IEmailTransport, IHttpClient, IInboundParser, IMessageSender } from "../../domain/ports";

// ---------------- WhatsApp Business (Cloud API) ----------------

interface WhatsAppWebhook {
  entry?: {
    changes?: {
      value?: {
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: {
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          /** Nota de voz (`voice: true`) o archivo de audio. La duración no viene en el webhook. */
          audio?: { id: string; mime_type?: string; voice?: boolean };
          image?: { id: string; mime_type?: string; caption?: string };
          video?: { id: string; mime_type?: string; caption?: string };
          context?: { forwarded?: boolean; frequently_forwarded?: boolean };
        }[];
      };
    }[];
  }[];
}

export class WhatsAppWebhookParser implements IInboundParser {
  readonly channel = "whatsapp" as const;

  parse(payload: unknown): InboundMessage | null {
    const value = (payload as WhatsAppWebhook)?.entry?.[0]?.changes?.[0]?.value;
    const m = value?.messages?.[0];
    const isText = m?.type === "text" && !!m.text;
    const isAudio = m?.type === "audio" && !!m.audio?.id;
    const isImage = m?.type === "image" && !!m.image?.id;
    const isVideo = m?.type === "video" && !!m.video?.id;
    if (!m || (!isText && !isAudio && !isImage && !isVideo)) return null; // estados de entrega, stickers, etc.
    return {
      channel: this.channel,
      from: `+${m.from.replace(/^\+/, "")}`,
      displayName: value?.contacts?.[0]?.profile?.name,
      text: m.text?.body ?? m.image?.caption ?? m.video?.caption ?? "",
      ...(isAudio ? { audio: { ref: m.audio!.id, mime: m.audio!.mime_type } } : {}),
      ...(isImage ? { image: { ref: m.image!.id, mime: m.image!.mime_type } } : {}),
      ...(isVideo ? { video: { ref: m.video!.id, mime: m.video!.mime_type } } : {}),
      externalId: m.id,
      receivedAt: new Date(Number(m.timestamp) * 1000),
      forwarded: !!m.context?.forwarded || !!m.context?.frequently_forwarded,
      forwardedManyTimes: !!m.context?.frequently_forwarded,
    };
  }
}

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
}

export class WhatsAppCloudSender implements IMessageSender {
  readonly channel = "whatsapp" as const;

  constructor(
    private readonly http: IHttpClient,
    private readonly cfg: WhatsAppConfig,
  ) {}

  async send(msg: OutboundMessage): Promise<DeliveryResult> {
    const base = {
      messaging_product: "whatsapp",
      to: msg.to.replace(/^\+/, ""),
      ...(msg.replyTo ? { context: { message_id: msg.replyTo.externalId } } : {}),
    };
    const body = msg.template
      ? { ...base, type: "template", template: { name: msg.template.name, language: { code: msg.template.language }, components: [{ type: "body", parameters: msg.template.params.map((text) => ({ type: "text", text })) }] } }
      : { ...base, type: "text", text: { body: msg.text, preview_url: false } };

    const res = await this.http.send("POST", `https://graph.facebook.com/${this.cfg.apiVersion ?? "v21.0"}/${this.cfg.phoneNumberId}/messages`, body, {
      authorization: `Bearer ${this.cfg.accessToken}`,
    });
    if (res.status >= 200 && res.status < 300) {
      const id = (JSON.parse(res.text || "{}") as { messages?: { id: string }[] }).messages?.[0]?.id;
      // Audio aparte (WhatsApp lo descarga del link): si falla, el texto ya llegó.
      if (msg.audio && !msg.template) {
        await this.http.send("POST", `https://graph.facebook.com/${this.cfg.apiVersion ?? "v21.0"}/${this.cfg.phoneNumberId}/messages`,
          { messaging_product: "whatsapp", to: base.to, type: "audio", audio: { link: msg.audio.url } }, { authorization: `Bearer ${this.cfg.accessToken}` });
      }
      return { ok: true, providerMessageId: id, httpStatus: res.status };
    }
    return { ok: false, httpStatus: res.status, error: res.text.slice(0, 300) };
  }
}

// ---------------- Telegram (Bot API) ----------------

interface TelegramUpdate {
  message?: {
    message_id: number;
    date: number;
    text?: string;
    /** Epígrafe de un audio. */
    caption?: string;
    voice?: TelegramAudio;
    audio?: TelegramAudio;
    /** La misma foto en varios tamaños (el último es el más grande). */
    photo?: { file_id: string; file_size?: number }[];
    /** Imagen mandada "como archivo" (sin comprimir). */
    document?: { file_id: string; mime_type?: string };
    video?: { file_id: string; mime_type?: string; duration?: number };
    chat: { id: number };
    from?: { first_name?: string; username?: string };
    forward_origin?: unknown;
    forward_date?: number;
  };
}

interface TelegramAudio {
  file_id: string;
  duration?: number;
  mime_type?: string;
}

export class TelegramUpdateParser implements IInboundParser {
  readonly channel = "telegram" as const;

  parse(payload: unknown): InboundMessage | null {
    const m = (payload as TelegramUpdate)?.message;
    const audio = m?.voice ?? m?.audio;
    const photo = m?.photo?.at(-1);
    const image = photo ? { ref: photo.file_id, mime: "image/jpeg" } :m?.document?.mime_type?.startsWith("image/") ? { ref: m.document.file_id, mime: m.document.mime_type } : undefined;
    const video = m?.video ? { ref: m.video.file_id, mime: m.video.mime_type ?? "video/mp4", seconds: m.video.duration } : m?.document?.mime_type?.startsWith("video/") ? { ref: m.document.file_id, mime: m.document.mime_type } : undefined;
    if (!m || (!m.text && !audio && !image && !video)) return null;
    return {
      channel: this.channel,
      from: String(m.chat.id),
      displayName: m.from?.first_name ?? m.from?.username,
      text: m.text ?? m.caption ?? "",
      ...(audio ? { audio: { ref: audio.file_id, mime: audio.mime_type, seconds: audio.duration } } : {}),
      ...(image ? { image } : {}),
      ...(video ? { video } : {}),
      externalId: String(m.message_id),
      receivedAt: new Date(m.date * 1000),
      forwarded: !!m.forward_origin || !!m.forward_date,
    };
  }
}

export class TelegramBotSender implements IMessageSender {
  readonly channel = "telegram" as const;

  constructor(
    private readonly http: IHttpClient,
    private readonly botToken: string,
  ) {}

  async send(msg: OutboundMessage): Promise<DeliveryResult> {
    const res = await this.http.send("POST", `https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      chat_id: msg.to,
      text: msg.text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(msg.replyTo ? { reply_parameters: { message_id: Number(msg.replyTo.externalId), allow_sending_without_reply: true } } : {}),
    });
    const data = JSON.parse(res.text || "{}") as { ok?: boolean; result?: { message_id: number }; description?: string };
    if (data.ok && msg.audio) {
      await this.http.send("POST", `https://api.telegram.org/bot${this.botToken}/sendAudio`, { chat_id: msg.to, audio: msg.audio.url, title: "Respuesta de Sin Humo" });
    }
    return data.ok
      ? { ok: true, providerMessageId: String(data.result?.message_id), httpStatus: res.status }
      : { ok: false, httpStatus: res.status, error: data.description ?? res.text.slice(0, 300) };
  }
}

/**
 * Puesta en marcha del bot de Telegram (se usa una vez, desde la línea de comandos):
 * quién es el bot, quiénes le escribieron (para la lista de prueba) y dónde avisa los mensajes.
 */
export class TelegramBotAdmin {
  constructor(
    private readonly http: IHttpClient,
    private readonly botToken: string,
  ) {}

  private async call<T>(method: string, body?: unknown): Promise<T> {
    const url = `https://api.telegram.org/bot${this.botToken}/${method}`;
    const res = body === undefined ? await this.http.get(url) : await this.http.send("POST", url, body);
    const data = JSON.parse(res.text || "{}") as { ok?: boolean; result?: T; description?: string };
    if (!data.ok) throw new Error(`Telegram (${method}): ${data.description ?? `HTTP ${res.status}`}`);
    return data.result as T;
  }

  me() {
    return this.call<{ id: number; username: string; first_name: string }>("getMe");
  }

  /** Últimos que le escribieron al bot. Sólo funciona mientras NO hay webhook (después, los mensajes van al webhook). */
  async recentChats(): Promise<{ chatId: string; name: string; text: string }[]> {
    const updates = await this.call<{ message?: { chat: { id: number }; from?: { first_name?: string; username?: string }; text?: string } }[]>("getUpdates", { limit: 50 });
    const seen = new Map<string, { chatId: string; name: string; text: string }>();
    for (const u of updates) {
      if (!u.message) continue;
      const chatId = String(u.message.chat.id);
      seen.set(chatId, { chatId, name: u.message.from?.username ? `@${u.message.from.username}` : (u.message.from?.first_name ?? ""), text: (u.message.text ?? "").slice(0, 40) });
    }
    return [...seen.values()];
  }

  setWebhook(url: string, secretToken: string) {
    return this.call<boolean>("setWebhook", { url, secret_token: secretToken, allowed_updates: ["message"], drop_pending_updates: true });
  }

  webhookInfo() {
    return this.call<{ url: string; pending_update_count: number; last_error_message?: string; last_error_date?: number }>("getWebhookInfo");
  }
}

// ---------------- Mail como canal ----------------

/** El canal "email" usa cualquier IEmailTransport (SMTP, SES, Resend...). */
export class EmailChannelSender implements IMessageSender {
  readonly channel = "email" as const;

  constructor(
    private readonly transport: IEmailTransport,
    private readonly from: string,
  ) {}

  send(msg: OutboundMessage): Promise<DeliveryResult> {
    const address = this.from.match(/<([^>]+)>/)?.[1] ?? this.from;
    const mail: EmailEnvelope = {
      from: msg.fromName ? `"${msg.fromName.replace(/["\\]/g, "")}" <${address}>` : this.from,
      to: msg.to,
      subject: msg.subject ?? "Sin Humo",
      text: msg.text,
      html: msg.html,
      inReplyTo: msg.replyTo?.externalId,
      references: msg.replyTo?.references ?? (msg.replyTo ? [msg.replyTo.externalId] : undefined),
      headers: msg.headers,
      attachments: msg.attachments,
    };
    return this.transport.send(mail);
  }
}

// ---------------- Para demo y tests ----------------

/** Guarda lo "enviado" en memoria. Permite simular fallas (429, 403) para probar el freno. */
export class RecordingSender implements IMessageSender {
  readonly outbox: OutboundMessage[] = [];
  nextResults: DeliveryResult[] = [];

  constructor(readonly channel: ChannelType) {}

  async send(msg: OutboundMessage): Promise<DeliveryResult> {
    const forced = this.nextResults.shift();
    if (forced && !forced.ok) return forced;
    this.outbox.push(msg);
    return { ok: true, providerMessageId: `${this.channel}-${this.outbox.length}` };
  }
}

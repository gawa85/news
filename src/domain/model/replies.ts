import type { ChannelType } from "./identity";
import type { ResponseContent } from "./messaging";

/**
 * DÓNDE se publica una respuesta.
 *  - email_thread: responder dentro del hilo de un mail (In-Reply-To).
 *  - chat:         responder citando un mensaje (WhatsApp, Telegram...).
 *  - forum_thread: publicar en un hilo de un foro (Discourse, etc.).
 *  - web_page:     comentario en una página (WordPress, widget propio, webhook del sitio).
 */
export type ReplyTargetKind = "email_thread" | "chat" | "forum_thread" | "web_page";

export interface ReplyTarget {
  kind: ReplyTargetKind;
  /** Qué integración publica: "email", "whatsapp", "discourse:foro.example", "wordpress:blog.example"... */
  destination: string;
  /** Dirección, id de hilo, id de post o URL de la página. */
  ref: string;
  /** Mensaje o post al que se responde (Message-ID del mail, id del mensaje de chat...). */
  inReplyTo?: string;
  /** Asunto del hilo (mails). */
  subject?: string;
  channel?: ChannelType;
}

export type ReplyVisibility = "private" | "public";

export function visibilityOf(target: ReplyTarget): ReplyVisibility {
  return target.kind === "forum_thread" || target.kind === "web_page" ? "public" : "private";
}

export type ReplyStatus = "pending_review" | "published" | "rejected" | "failed";

export interface ReplyDraft {
  id: string;
  requestedBy: string;
  target: ReplyTarget;
  content: ResponseContent;
  visibility: ReplyVisibility;
  status: ReplyStatus;
  /** Tema, para reportes de impacto por tema. */
  topic?: string;
  createdAt: Date;
  reviewedBy?: string;
  publishedAt?: Date;
  publishedUrl?: string;
  /** Id de la respuesta en el destino (id del post, Message-ID...). Lo usa la medición de impacto. */
  externalId?: string;
  error?: string;
}

export interface PublishResult {
  ok: boolean;
  url?: string;
  externalId?: string;
  error?: string;
  httpStatus?: number;
}

import type { ChannelType } from "./identity";

/** Mensaje recibido por cualquier canal, ya normalizado (el canal de origen deja de importar). */
export interface InboundMessage {
  channel: ChannelType;
  /** Dirección del remitente en ese canal: número, chat id, mail. */
  from: string;
  displayName?: string;
  text: string;
  externalId: string;
  receivedAt: Date;
  /** El mensaje es un reenvío (WhatsApp y Telegram lo informan). */
  forwarded?: boolean;
  /** WhatsApp marca los mensajes "reenviados muchas veces" (cadenas). */
  forwardedManyTimes?: boolean;
  /**
   * Nota de voz o audio: se transcribe antes de interpretar el mensaje (hasta entonces
   * `text` trae sólo el epígrafe, si lo hay). `ref` es el id del archivo en el canal.
   */
  audio?: { ref: string; mime?: string; seconds?: number };
  /** El texto salió de transcribir el audio. */
  transcribed?: boolean;
}

/**
 * Respuesta NEUTRA respecto del canal. Los casos de uso producen esto;
 * cada canal lo dibuja a su manera (WhatsApp corto, mail largo con HTML...).
 */
export interface ResponseContent {
  kind: "result" | "info" | "denied" | "error";
  /** Marca de la organización (marca blanca). */
  brand?: import("./commerce").BrandMark;
  /** Versión en audio (link a un archivo propio con vencimiento). */
  audio?: { url: string; mime: string; seconds?: number };
  title: string;
  summary?: string;
  sections: { heading?: string; lines: string[] }[];
  links: { label: string; url: string }[];
  footer?: string;
}

export interface OutboundMessage {
  channel: ChannelType;
  to: string;
  subject?: string;
  text: string;
  html?: string;
  /** Para qué se envía: lo usan las reglas de cumplimiento (no hay envíos no solicitados). */
  purpose?: import("./compliance").SendPurpose;
  /** Plantilla aprobada por la plataforma (necesaria en WhatsApp fuera de la ventana de 24 h). */
  template?: { name: string; language: string; params: string[] };
  /** Responder citando / dentro de un hilo. */
  replyTo?: { externalId: string; references?: string[] };
  headers?: Record<string, string>;
  /** Nombre del remitente (mail con marca blanca). */
  fromName?: string;
  /** Audio para escuchar la respuesta (WhatsApp y Telegram lo mandan aparte; el mail, como link). */
  audio?: { url: string; mime: string };
  /** Archivos adjuntos (sólo mail: reportes programados). */
  attachments?: { filename: string; contentType: string; content: Buffer }[];
}

export interface DeliveryResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  /** Código HTTP del proveedor: 429 = límite, 403 = rechazo. Alimenta el freno automático. */
  httpStatus?: number;
}

/** Lo que el usuario pidió, interpretado a partir del texto del mensaje. */
export type Command =
  | { type: "analyze_content"; text: string }
  | { type: "compare_sources"; topic: string; month?: string; includeUrls: string[] }
  | { type: "credibility"; outlet: string; topic: string }
  | { type: "exclude_site"; pattern: string }
  | { type: "list_rules" }
  | { type: "my_plan" }
  | { type: "follow_topic"; topic: string }
  | { type: "unfollow_topic"; topic: string }
  | { type: "list_topics" }
  | { type: "set_format"; format: import("./preferences").ResponseFormat }
  | { type: "quiet_hours"; from?: string; to?: string }
  | { type: "my_preferences" }
  | { type: "audio_replies"; on: boolean }
  | { type: "quiz_next" }
  | { type: "quiz_answer"; isSmoke: boolean }
  | { type: "quiz_progress" }
  | { type: "join_classroom"; code: string; alias: string }
  | { type: "invite" }
  | { type: "referral_code"; code: string }
  | { type: "support"; text: string }
  | { type: "support_list" }
  | { type: "help" };

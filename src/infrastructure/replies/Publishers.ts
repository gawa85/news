/**
 * PUBLICADORES de respuestas, uno por tipo de destino.
 *  - ChannelReplyPublisher: hilo de mail y chats (WhatsApp, Telegram) usando los canales.
 *  - DiscourseReplyPublisher: foros Discourse (API oficial: POST /posts.json).
 *  - WordPressCommentPublisher: comentarios en WordPress (REST API /wp/v2/comments).
 *  - SiteWebhookPublisher: cualquier sitio propio que exponga un endpoint (widget/comentarios).
 */
import { createHmac } from "node:crypto";
import type { PublishResult, ReplyTarget, ResponseContent } from "../../domain/model";
import type { IHttpClient, IReplyPublisher } from "../../domain/ports";
import type { NotificationService } from "../../application/messaging/NotificationService";

export function toMarkdown(c: ResponseContent): string {
  return [
    `**${c.title}**`,
    c.summary ?? "",
    ...c.sections.map((s) => [s.heading ? `**${s.heading}**` : "", ...s.lines.map((l) => `- ${l}`)].filter(Boolean).join("\n")),
    c.links.length ? `Fuentes: ${c.links.map((l) => `[${l.label}](${l.url})`).join(" · ")}` : "",
    c.footer ? `_${c.footer}_` : "",
  ].filter(Boolean).join("\n\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toHtml(c: ResponseContent): string {
  return [
    `<p><strong>${esc(c.title)}</strong></p>`,
    c.summary ? `<p>${esc(c.summary)}</p>` : "",
    ...c.sections.map((s) => `${s.heading ? `<p><strong>${esc(s.heading)}</strong></p>` : ""}<ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`),
    c.links.length ? `<p>Fuentes: ${c.links.map((l) => `<a href="${esc(l.url)}" rel="nofollow">${esc(l.label)}</a>`).join(" · ")}</p>` : "",
    c.footer ? `<p><em>${esc(c.footer)}</em></p>` : "",
  ].join("");
}

/** Mail en el mismo hilo y chats citando el mensaje. Usa los canales (ya con reglas de cumplimiento). */
export class ChannelReplyPublisher implements IReplyPublisher {
  constructor(private readonly notifications: NotificationService) {}

  supports(t: ReplyTarget): boolean {
    return (t.kind === "email_thread" && t.destination === "email") || (t.kind === "chat" && ["whatsapp", "telegram", "sms"].includes(t.destination));
  }

  async publish(t: ReplyTarget, content: ResponseContent): Promise<PublishResult> {
    const channel = t.kind === "email_thread" ? "email" : (t.destination as "whatsapp" | "telegram" | "sms");
    const r = await this.notifications.sendTo(channel, t.ref, content, "reply", {
      ...(t.subject ? { subject: t.subject } : {}),
      ...(t.inReplyTo ? { replyTo: { externalId: t.inReplyTo } } : {}),
    });
    return { ok: r.ok, externalId: r.providerMessageId, error: r.error, httpStatus: r.httpStatus };
  }
}

export interface DiscourseSite {
  host: string;
  baseUrl: string;
  apiKey: string;
  apiUsername: string;
}

/** target.ref = id del tema; target.inReplyTo = número de post al que se responde (opcional). */
export class DiscourseReplyPublisher implements IReplyPublisher {
  constructor(
    private readonly http: IHttpClient,
    private readonly sites: DiscourseSite[],
  ) {}

  supports(t: ReplyTarget): boolean {
    return t.kind === "forum_thread" && !!this.site(t);
  }

  async publish(t: ReplyTarget, content: ResponseContent): Promise<PublishResult> {
    const site = this.site(t)!;
    const res = await this.http.send(
      "POST",
      `${site.baseUrl}/posts.json`,
      { topic_id: Number(t.ref), raw: toMarkdown(content), ...(t.inReplyTo ? { reply_to_post_number: Number(t.inReplyTo) } : {}) },
      { "Api-Key": site.apiKey, "Api-Username": site.apiUsername },
    );
    if (res.status >= 300) return { ok: false, httpStatus: res.status, error: res.text.slice(0, 300) };
    const post = JSON.parse(res.text) as { id: number; topic_id: number; post_number: number; topic_slug?: string };
    return { ok: true, externalId: String(post.id), url: `${site.baseUrl}/t/${post.topic_slug ?? "-"}/${post.topic_id}/${post.post_number}`, httpStatus: res.status };
  }

  site(t: ReplyTarget): DiscourseSite | undefined {
    return this.sites.find((s) => t.destination === `discourse:${s.host}`);
  }
}

export interface WordPressSite {
  host: string;
  baseUrl: string;
  user: string;
  /** "Application password" de WordPress (no la contraseña de la cuenta). */
  appPassword: string;
}

/** target.ref = id del post; target.inReplyTo = id del comentario padre (opcional). */
export class WordPressCommentPublisher implements IReplyPublisher {
  constructor(
    private readonly http: IHttpClient,
    private readonly sites: WordPressSite[],
  ) {}

  supports(t: ReplyTarget): boolean {
    return t.kind === "web_page" && !!this.site(t);
  }

  async publish(t: ReplyTarget, content: ResponseContent): Promise<PublishResult> {
    const site = this.site(t)!;
    const res = await this.http.send(
      "POST",
      `${site.baseUrl}/wp-json/wp/v2/comments`,
      { post: Number(t.ref), content: toHtml(content), ...(t.inReplyTo ? { parent: Number(t.inReplyTo) } : {}) },
      { authorization: `Basic ${Buffer.from(`${site.user}:${site.appPassword}`).toString("base64")}` },
    );
    if (res.status >= 300) return { ok: false, httpStatus: res.status, error: res.text.slice(0, 300) };
    const c = JSON.parse(res.text) as { id: number; link?: string };
    return { ok: true, externalId: String(c.id), url: c.link, httpStatus: res.status };
  }

  site(t: ReplyTarget): WordPressSite | undefined {
    return this.sites.find((s) => t.destination === `wordpress:${s.host}`);
  }
}

export interface OwnSite {
  host: string;
  endpoint: string;
  secret: string;
}

/**
 * Sitio propio o de un cliente: se le manda la respuesta firmada (HMAC) a su endpoint
 * y el sitio la muestra (comentario, widget "verificado con Sin Humo", etc.).
 * target.ref = URL de la página.
 */
export class SiteWebhookPublisher implements IReplyPublisher {
  constructor(
    private readonly http: IHttpClient,
    private readonly sites: OwnSite[],
  ) {}

  supports(t: ReplyTarget): boolean {
    return t.kind === "web_page" && this.sites.some((s) => t.destination === `site:${s.host}`);
  }

  async publish(t: ReplyTarget, content: ResponseContent): Promise<PublishResult> {
    const site = this.sites.find((s) => t.destination === `site:${s.host}`)!;
    const body = JSON.stringify({ pageUrl: t.ref, inReplyTo: t.inReplyTo, markdown: toMarkdown(content), html: toHtml(content) });
    const ts = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", site.secret).update(`${ts}.${body}`).digest("hex");
    const res = await this.http.send("POST", site.endpoint, body, {
      "content-type": "application/json",
      "x-sinhumo-timestamp": ts,
      "x-sinhumo-signature": `sha256=${signature}`,
    });
    if (res.status >= 300) return { ok: false, httpStatus: res.status, error: res.text.slice(0, 300) };
    const data = JSON.parse(res.text || "{}") as { id?: string; url?: string };
    return { ok: true, externalId: data.id, url: data.url ?? t.ref, httpStatus: res.status };
  }
}

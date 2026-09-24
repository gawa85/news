/**
 * RECOLECTORES DE IMPACTO, uno por destino. Cada uno informa sólo lo que su
 * plataforma expone; nunca se estima lo que no se puede medir.
 */
import type { ImpactMetrics, ReplyDraft } from "../../domain/model";
import type { IHttpClient, IImpactCollector } from "../../domain/ports";
import type { DiscourseSite, WordPressSite } from "../replies/Publishers";

/**
 * Discourse: lecturas, "me gusta" y respuestas de nuestro post; y si el post ORIGINAL
 * (target.inReplyTo = número de post en el tema) fue editado o borrado después.
 */
export class DiscourseImpactCollector implements IImpactCollector {
  constructor(
    private readonly http: IHttpClient,
    private readonly sites: DiscourseSite[],
  ) {}

  supports(d: ReplyDraft): boolean {
    return d.target.kind === "forum_thread" && !!this.site(d) && !!d.externalId;
  }

  async collect(d: ReplyDraft): Promise<ImpactMetrics> {
    const site = this.site(d)!;
    const headers = { "Api-Key": site.apiKey, "Api-Username": site.apiUsername };
    const res = await this.http.get(`${site.baseUrl}/posts/${d.externalId}.json`, headers);
    if (res.status === 404) return { replyRemoved: true };
    if (res.status !== 200) throw new Error(`Discourse respondió ${res.status}`);
    const post = JSON.parse(res.text) as {
      reads?: number; reply_count?: number; deleted_at?: string | null; hidden?: boolean;
      actions_summary?: { id: number; count?: number }[];
    };
    const metrics: ImpactMetrics = {
      views: post.reads,
      replies: post.reply_count,
      reactionsPositive: post.actions_summary?.find((a) => a.id === 2)?.count ?? 0, // 2 = "like"
      replyRemoved: !!post.deleted_at || !!post.hidden,
    };

    if (d.target.inReplyTo && d.publishedAt) {
      const orig = await this.http.get(`${site.baseUrl}/posts/by_number/${d.target.ref}/${d.target.inReplyTo}.json`, headers);
      if (orig.status === 404) metrics.originalRemoved = true;
      else if (orig.status === 200) {
        const o = JSON.parse(orig.text) as { updated_at?: string; version?: number; deleted_at?: string | null };
        metrics.originalRemoved = !!o.deleted_at;
        metrics.originalCorrected = (o.version ?? 1) > 1 && !!o.updated_at && new Date(o.updated_at) > d.publishedAt;
      }
    }
    return metrics;
  }

  private site(d: ReplyDraft) {
    return this.sites.find((s) => d.target.destination === `discourse:${s.host}`);
  }
}

/** WordPress: si nuestro comentario sigue aprobado y si el post original se modificó después. */
export class WordPressImpactCollector implements IImpactCollector {
  constructor(
    private readonly http: IHttpClient,
    private readonly sites: WordPressSite[],
  ) {}

  supports(d: ReplyDraft): boolean {
    return d.target.kind === "web_page" && !!this.site(d) && !!d.externalId;
  }

  async collect(d: ReplyDraft): Promise<ImpactMetrics> {
    const site = this.site(d)!;
    const headers = { authorization: `Basic ${Buffer.from(`${site.user}:${site.appPassword}`).toString("base64")}` };
    const c = await this.http.get(`${site.baseUrl}/wp-json/wp/v2/comments/${d.externalId}?context=edit`, headers);
    const metrics: ImpactMetrics = {};
    if (c.status === 404) metrics.replyRemoved = true;
    else if (c.status === 200) metrics.replyRemoved = ["spam", "trash"].includes((JSON.parse(c.text) as { status: string }).status);

    const p = await this.http.get(`${site.baseUrl}/wp-json/wp/v2/posts/${d.target.ref}`, headers);
    if (p.status === 404) metrics.originalRemoved = true;
    else if (p.status === 200 && d.publishedAt) {
      const post = JSON.parse(p.text) as { modified_gmt?: string };
      metrics.originalCorrected = !!post.modified_gmt && new Date(`${post.modified_gmt}Z`) > d.publishedAt;
    }
    return metrics;
  }

  private site(d: ReplyDraft) {
    return this.sites.find((s) => d.target.destination === `wordpress:${s.host}`);
  }
}

/**
 * Chats y mails: el estado de entrega/lectura llega por webhook del proveedor
 * (WhatsApp "statuses": sent/delivered/read). Se guarda acá y el recolector lo informa.
 */
export class DeliveryStatusCollector implements IImpactCollector {
  private readonly statuses = new Map<string, { delivered: boolean; read: boolean; replies: number }>();

  supports(d: ReplyDraft): boolean {
    return (d.target.kind === "chat" || d.target.kind === "email_thread") && !!d.externalId;
  }

  /** Lo llama el webhook de estados del proveedor. */
  record(externalId: string, status: "delivered" | "read" | "replied"): void {
    const s = this.statuses.get(externalId) ?? { delivered: false, read: false, replies: 0 };
    if (status === "delivered") s.delivered = true;
    if (status === "read") (s.delivered = true), (s.read = true);
    if (status === "replied") s.replies++;
    this.statuses.set(externalId, s);
  }

  async collect(d: ReplyDraft): Promise<ImpactMetrics> {
    const s = this.statuses.get(d.externalId!);
    return s ? { delivered: s.delivered, read: s.read, replies: s.replies } : {};
  }
}

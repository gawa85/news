import { randomUUID } from "node:crypto";
import type { ContentItem, SourceConnection } from "../../domain/model";
import type { IContentSource, IHttpClient, PullResult } from "../../domain/ports";
import { htmlToText } from "../mail/MailparserMimeParser";

/**
 * Feeds RSS y Atom (blogs, medios, organismos). Config: { url }.
 * El cursor es la fecha del ítem más nuevo ya procesado.
 */
export class RssFeedSource implements IContentSource {
  readonly type = "rss" as const;

  constructor(private readonly http: IHttpClient) {}

  async test(conn: SourceConnection): Promise<void> {
    const res = await this.http.get(conn.config.url!);
    if (res.status !== 200 || !/<(rss|feed)[\s>]/i.test(res.text)) throw new Error("La URL no devuelve un feed RSS/Atom válido.");
  }

  async pull(conn: SourceConnection): Promise<PullResult> {
    const res = await this.http.get(conn.config.url!);
    if (res.status !== 200) throw new Error(`El feed respondió ${res.status}.`);
    const since = conn.cursor ? new Date(conn.cursor) : new Date(0);
    const feedDomain = new URL(conn.config.url!).hostname.replace(/^www\./, "");
    // El origen es quien publicó la nota (dominio del link), no el servidor del feed.
    const domainOf = (link?: string) => {
      try {
        return link ? new URL(link).hostname.replace(/^www\./, "") : feedDomain;
      } catch {
        return feedDomain;
      }
    };

    const items = parseFeed(res.text)
      .filter((e) => e.date > since)
      .map<ContentItem>((e) => ({
        id: randomUUID(),
        sourceType: "rss",
        origin: { name: conn.name, address: conn.config.url, domain: domainOf(e.link) },
        title: e.title,
        text: htmlToText(e.body),
        urls: e.link ? [e.link] : [],
        publishedAt: e.date,
        receivedAt: new Date(),
        attachments: [],
        metadata: { guid: e.guid ?? e.link ?? "" },
      }));
    const newest = items.reduce((max, i) => (i.publishedAt > max ? i.publishedAt : max), since);
    return { items, cursor: newest.toISOString() };
  }
}

interface FeedEntry {
  title: string;
  link?: string;
  body: string;
  date: Date;
  guid?: string;
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m?.[1]?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1").trim();
}

export function parseFeed(xml: string): FeedEntry[] {
  const rss = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  if (rss.length) {
    return rss.map((it) => ({
      title: tag(it, "title") ?? "",
      link: tag(it, "link"),
      body: tag(it, "content:encoded") ?? tag(it, "description") ?? "",
      date: new Date(tag(it, "pubDate") ?? 0),
      guid: tag(it, "guid"),
    }));
  }
  return [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => {
    const it = m[0];
    return {
      title: tag(it, "title") ?? "",
      link: it.match(/<link[^>]*href="([^"]+)"/i)?.[1],
      body: tag(it, "content") ?? tag(it, "summary") ?? "",
      date: new Date(tag(it, "updated") ?? tag(it, "published") ?? 0),
      guid: tag(it, "id"),
    };
  });
}

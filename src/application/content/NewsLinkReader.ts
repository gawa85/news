import type { ContentItem, Outlet } from "../../domain/model";
import type { INewsArticleReader, IOutletReader, NewsArticleRead } from "../../domain/ports";
import { sharedNewsLink } from "../../domain/rules/newsLinks";

export type SharedArticle = NewsArticleRead & { domain: string; outletId?: string; outletName?: string };

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/**
 * LINKS A NOTAS: si alguien manda (o pega) sólo el link de una nota, se analiza la NOTA —título
 * y cuerpo—, no el link. Si el sitio es un medio del catálogo, se dice cuál.
 */
export class NewsLinkReader {
  constructor(
    private readonly reader: INewsArticleReader,
    private readonly outlets: IOutletReader,
  ) {}

  /** Si el texto es un link a una nota, la lee. `failed`: era un link pero no se pudo leer. */
  async readShared(text: string): Promise<{ article?: SharedArticle; failed?: string } | undefined> {
    const url = sharedNewsLink(text);
    if (!url) return undefined;
    try {
      const read = await this.reader.read(url);
      const domain = hostOf(read.url) || hostOf(url.toString());
      const outlet = await this.outletFor(domain);
      return { article: { ...read, domain, outletId: outlet?.id, outletName: outlet?.name } };
    } catch (e) {
      return { failed: e instanceof Error ? e.message : String(e) };
    }
  }

  /** El contenido a analizar: la nota, con de dónde viene. */
  contentFor(a: SharedArticle, base: ContentItem): ContentItem {
    return {
      ...base,
      sourceType: "web",
      title: a.title,
      text: a.text,
      origin: { name: a.outletName ?? a.siteName, address: a.url, domain: a.domain },
      urls: [a.url],
      publishedAt: a.publishedAt ?? base.publishedAt,
      metadata: { ...base.metadata, "article-url": a.url, ...(a.author ? { author: a.author } : {}) },
    };
  }

  /** Qué se leyó (arriba del análisis por el chat: así la persona sabe qué se analizó). */
  describe(a: SharedArticle): { heading: string; lines: string[] } {
    const when = a.publishedAt ? a.publishedAt.toISOString().slice(0, 10).split("-").reverse().join("/") : undefined;
    return {
      heading: `📰 Nota de ${a.outletName ?? a.siteName ?? a.domain}`,
      lines: [a.title ? `“${a.title}”` : "", [a.author, when].filter(Boolean).join(" · ")].filter(Boolean),
    };
  }

  private async outletFor(domain: string): Promise<Outlet | undefined> {
    if (!domain) return undefined;
    return (await this.outlets.findAll()).find((o) => {
      const h = hostOf(o.url);
      return h && (domain === h || domain.endsWith(`.${h}`));
    });
  }
}

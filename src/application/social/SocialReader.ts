import { ValidationError } from "../../domain/errors";
import type { ContentItem, SocialPlatform, SocialPost } from "../../domain/model";
import type { FlagContext, IFeatureFlags, ISocialSource } from "../../domain/ports";
import { sharedSocialLink, socialPlatformOf } from "../../domain/rules/social";

export const PLATFORM_NAMES: Record<SocialPlatform, string> = {
  youtube: "YouTube", x: "X (Twitter)", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", telegram: "Telegram", threads: "Threads", web: "la web",
};

/**
 * REDES COMO FUENTE: cuando alguien reenvía un link a un posteo o un video, lo que hay que
 * analizar es lo que DICE esa publicación (y quién la publicó), no el link.
 * No sabe cómo se lee cada red (DIP): usa un ISocialSource (API, oEmbed, metadatos…).
 */
export class SocialReader {
  constructor(
    private readonly source: ISocialSource,
    private readonly flags?: IFeatureFlags,
  ) {}

  /** Si el mensaje es un link a una red, lo lee. `failed`: era un link pero no se pudo leer. */
  async readShared(text: string, ctx: FlagContext): Promise<{ post?: SocialPost; failed?: string } | undefined> {
    const url = sharedSocialLink(text);
    if (!url) return undefined;
    if (this.flags && !(await this.flags.isEnabled("social_links", ctx))) return undefined;
    const platform = socialPlatformOf(url);
    if (!this.source.canRead(url, platform)) return undefined;
    try {
      return { post: await this.source.read(url, platform) };
    } catch (e) {
      return { failed: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Para la API: leer cualquier link de una red. */
  async read(link: string): Promise<SocialPost> {
    let url: URL;
    try {
      url = new URL(link.trim());
    } catch {
      throw new ValidationError("El link no es válido.");
    }
    const platform = socialPlatformOf(url);
    if (!this.source.canRead(url, platform)) throw new ValidationError("No sé leer publicaciones de ese sitio.");
    return this.source.read(url, platform);
  }

  /** El contenido a analizar: el texto de la publicación, con su autor y datos públicos. */
  contentFor(post: SocialPost, base: ContentItem): ContentItem {
    const metadata: Record<string, string> = { ...base.metadata, platform: post.platform, via: post.via };
    if (post.postId) metadata["post-id"] = post.postId;
    if (post.metrics?.views !== undefined) metadata.views = String(post.metrics.views);
    return {
      ...base,
      sourceType: "social",
      title: post.title,
      text: post.text,
      origin: { name: post.author?.name, address: post.author?.handle ?? post.author?.url, domain: new URL(post.url).hostname },
      urls: [post.url, ...(post.text.match(/https?:\/\/[^\s)]+/g) ?? [])],
      publishedAt: post.publishedAt ?? base.publishedAt,
      metadata,
    };
  }

  /** Qué se leyó (para mostrarlo arriba del análisis: así la persona sabe qué se analizó). */
  describe(post: SocialPost): { heading: string; lines: string[] } {
    const who = [post.author?.name, post.author?.handle].filter(Boolean).join(" ");
    const when = post.publishedAt ? post.publishedAt.toISOString().slice(0, 10).split("-").reverse().join("/") : undefined;
    const views = post.metrics?.views !== undefined ? `${post.metrics.views.toLocaleString("es-AR")} vistas` : undefined;
    const text = post.text.length > 300 ? `${post.text.slice(0, 299)}…` : post.text;
    return {
      heading: `📱 Publicación en ${PLATFORM_NAMES[post.platform]}`,
      lines: [[who, when, views].filter(Boolean).join(" · "), `“${text}”`].filter(Boolean),
    };
  }
}

/**
 * LECTORES DE REDES. Sólo vías permitidas por cada plataforma: API oficial (YouTube), oEmbed
 * (lo que las plataformas ofrecen para mostrar un posteo en otro sitio) y metadatos públicos
 * del link (Open Graph). Nada que requiera iniciar sesión ni saltear los términos.
 */
import type { SocialPlatform, SocialPost } from "../../domain/model";
import type { ICache, IHttpClient, IPageCapturer, ISocialSource } from "../../domain/ports";
import { youtubeVideoId, xStatusId } from "../../domain/rules/social";
import { htmlToText } from "../evidence/HttpPageCapturer";

const MAX_TEXT = 5_000;
const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);
const num = (v: unknown) => (v === undefined || v === null || Number.isNaN(Number(v)) ? undefined : Number(v));

async function getJson<T>(http: IHttpClient, url: string, what: string): Promise<T> {
  const res = await http.get(url);
  if (res.status !== 200) throw new Error(`${what} respondió HTTP ${res.status}.`);
  return JSON.parse(res.text) as T;
}

// ---------------- YouTube: API oficial ----------------

/** YouTube Data API v3 (clave gratuita con cupo diario): título, descripción, canal, fecha y números. */
export class YouTubeDataApiSource implements ISocialSource {
  readonly id = "youtube-api";

  constructor(
    private readonly http: IHttpClient,
    private readonly apiKey: string,
  ) {}

  canRead(url: URL, platform: SocialPlatform): boolean {
    return platform === "youtube" && !!youtubeVideoId(url);
  }

  async read(url: URL): Promise<SocialPost> {
    const id = youtubeVideoId(url)!;
    const out = await getJson<{ items?: { snippet: { title: string; description?: string; channelTitle?: string; channelId?: string; publishedAt?: string }; statistics?: Record<string, string> }[] }>(
      this.http,
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${encodeURIComponent(id)}&key=${encodeURIComponent(this.apiKey)}`,
      "YouTube",
    );
    const v = out.items?.[0];
    if (!v) throw new Error("El video no existe o es privado.");
    const s = v.statistics ?? {};
    return {
      platform: "youtube",
      url: `https://www.youtube.com/watch?v=${id}`,
      postId: id,
      author: { name: v.snippet.channelTitle, url: v.snippet.channelId ? `https://www.youtube.com/channel/${v.snippet.channelId}` : undefined },
      publishedAt: v.snippet.publishedAt ? new Date(v.snippet.publishedAt) : undefined,
      title: v.snippet.title,
      text: clip([v.snippet.title, v.snippet.description].filter(Boolean).join("\n\n")),
      metrics: { views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) },
      via: this.id,
    };
  }
}

// ---------------- oEmbed ----------------

const OEMBED: Partial<Record<SocialPlatform, (u: string, token?: string) => string | undefined>> = {
  youtube: (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  x: (u) => `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${encodeURIComponent(u)}`,
  tiktok: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`,
  // Meta pide un token de una app (gratuita) para Instagram y Facebook.
  instagram: (u, t) => (t ? `https://graph.facebook.com/v21.0/instagram_oembed?url=${encodeURIComponent(u)}&access_token=${encodeURIComponent(t)}` : undefined),
  facebook: (u, t) => (t ? `https://graph.facebook.com/v21.0/oembed_post?url=${encodeURIComponent(u)}&access_token=${encodeURIComponent(t)}` : undefined),
};

interface OEmbed {
  title?: string;
  author_name?: string;
  author_url?: string;
  author_unique_id?: string;
  html?: string;
}

/** oEmbed: lo que cada plataforma ofrece públicamente para mostrar un posteo en otro sitio. */
export class OEmbedSocialSource implements ISocialSource {
  readonly id = "oembed";

  constructor(
    private readonly http: IHttpClient,
    private readonly opts: { metaAccessToken?: string } = {},
  ) {}

  canRead(url: URL, platform: SocialPlatform): boolean {
    return !!OEMBED[platform]?.(url.toString(), this.opts.metaAccessToken);
  }

  async read(url: URL, platform: SocialPlatform): Promise<SocialPost> {
    const o = await getJson<OEmbed>(this.http, OEMBED[platform]!(url.toString(), this.opts.metaAccessToken)!, "oEmbed");
    // En X el texto viene dentro del HTML del "tweet incrustado": <p>texto</p>&mdash; Nombre (@usuario) <a>fecha</a>
    const quote = o.html ? /<p[^>]*>([\s\S]*?)<\/p>/i.exec(o.html)?.[1] : undefined;
    const body = quote ? htmlToText(`<p>${quote}</p>`).text : "";
    const handle = o.author_unique_id ?? (o.html ? /\(@([\w.]+)\)/.exec(o.html)?.[1] : undefined) ?? o.author_url?.split("/").filter(Boolean).pop();
    const date = o.html ? /<a[^>]*>([A-Z][a-z]+ \d{1,2}, \d{4})<\/a>\s*<\/blockquote>/.exec(o.html)?.[1] : undefined;
    const text = [o.title, body].filter((s) => s && s.trim()).join("\n\n");
    if (!text) throw new Error("oEmbed no trajo texto.");
    return {
      platform,
      url: url.toString(),
      postId: platform === "x" ? xStatusId(url) : undefined,
      author: { name: o.author_name, handle: handle ? `@${handle.replace(/^@/, "")}` : undefined, url: o.author_url },
      publishedAt: date ? new Date(`${date} UTC`) : undefined,
      title: o.title,
      text: clip(text),
      via: this.id,
    };
  }
}

// ---------------- Metadatos públicos (Open Graph) ----------------

/** Todas las <meta> de una página: property/name → content. */
function metaTags(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content !== undefined && !out.has(key)) out.set(key, htmlToText(content).text);
  }
  return out;
}

/**
 * Cualquier link (canales públicos de Telegram, Threads, sitios): lo que la página publica
 * para mostrarse al compartirla. Se baja con la descarga protegida contra SSRF.
 */
export class OpenGraphSocialSource implements ISocialSource {
  readonly id = "open-graph";

  constructor(
    private readonly capturer: IPageCapturer,
    private readonly maxBytes = 2 * 1024 * 1024,
  ) {}

  canRead(): boolean {
    return true;
  }

  async read(url: URL, platform: SocialPlatform): Promise<SocialPost> {
    const page = await this.capturer.capture(url.toString(), this.maxBytes);
    if (page.status >= 400) throw new Error(`La página respondió ${page.status}.`);
    const m = metaTags(page.body.toString("utf8"));
    const title = m.get("og:title") ?? m.get("twitter:title") ?? page.title;
    const description = m.get("og:description") ?? m.get("twitter:description") ?? m.get("description");
    const text = [title, description].filter(Boolean).join("\n\n") || page.text.slice(0, 1_000);
    if (!text.trim()) throw new Error("La página no tiene texto que leer.");
    const published = m.get("article:published_time") ?? m.get("og:updated_time");
    const handle = m.get("twitter:creator") ?? m.get("twitter:site");
    return {
      platform,
      url: page.finalUrl,
      author: { name: m.get("og:site_name") ?? m.get("author"), handle },
      publishedAt: published && !Number.isNaN(Date.parse(published)) ? new Date(published) : undefined,
      title,
      text: clip(text),
      via: this.id,
    };
  }
}

// ---------------- Composición ----------------

/**
 * Cadena de lectores (del más rico al más básico): el primero que puede y responde gana.
 * Si una vía falla (cupo agotado, posteo sin oEmbed), se prueba la siguiente.
 */
export class FallbackSocialSource implements ISocialSource {
  readonly id = "cadena";

  constructor(private readonly sources: ISocialSource[]) {}

  canRead(url: URL, platform: SocialPlatform): boolean {
    return this.sources.some((s) => s.canRead(url, platform));
  }

  async read(url: URL, platform: SocialPlatform): Promise<SocialPost> {
    const errors: string[] = [];
    for (const s of this.sources.filter((x) => x.canRead(url, platform))) {
      try {
        return await s.read(url, platform);
      } catch (e) {
        errors.push(`${s.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new Error(`No se pudo leer la publicación (${errors.join("; ") || "ninguna fuente la reconoce"}).`);
  }
}

/** No pide dos veces el mismo posteo (las cadenas se reenvían mucho). */
export class CachedSocialSource implements ISocialSource {
  get id() {
    return this.inner.id;
  }

  constructor(
    private readonly inner: ISocialSource,
    private readonly cache: ICache,
    private readonly ttlSeconds = 3_600,
  ) {}

  canRead(url: URL, platform: SocialPlatform): boolean {
    return this.inner.canRead(url, platform);
  }

  async read(url: URL, platform: SocialPlatform): Promise<SocialPost> {
    const key = `social:${url.toString()}`;
    const hit = await this.cache.get<SocialPost>(key);
    if (hit) return { ...hit, publishedAt: hit.publishedAt ? new Date(hit.publishedAt) : undefined };
    const post = await this.inner.read(url, platform);
    await this.cache.set(key, post, this.ttlSeconds);
    return post;
  }
}

/** Para tests y demo: posteos cargados a mano. */
export class FakeSocialSource implements ISocialSource {
  readonly id = "fake-social";
  readonly posts = new Map<string, Omit<SocialPost, "via">>();
  readonly reads: string[] = [];
  /** Si se carga, toda lectura falla con este motivo (posteo borrado, cupo agotado…). */
  failWith?: string;

  canRead(url: URL): boolean {
    return this.posts.has(url.toString());
  }

  async read(url: URL): Promise<SocialPost> {
    this.reads.push(url.toString());
    if (this.failWith) throw new Error(this.failWith);
    return { ...this.posts.get(url.toString())!, via: this.id };
  }
}

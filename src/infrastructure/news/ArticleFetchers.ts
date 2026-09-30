import { extractArticle } from "../content/ArticleExtractor";
import { canonicalUrl, urlMatches, type Article, type Outlet } from "../../domain/model";
import type { IArticleFetcher, IIdGenerator, IOutletReader, IPageCapturer } from "../../domain/ports";
import { HttpPageCapturer } from "../evidence/HttpPageCapturer";

/**
 * Resuelve a qué medio pertenece una URL. Si el dominio no está registrado,
 * se usa un id genérico "web:<dominio>" para que igual cuente como fuente distinta.
 */
export async function resolveOutletId(url: string, outlets: IOutletReader): Promise<string> {
  const all: Outlet[] = await outlets.findAll();
  const match = all.find((o) => urlMatches(url, o.url));
  return match ? match.id : `web:${new URL(url).hostname.replace(/^www\./, "")}`;
}

/** Para demo y tests: "trae" notas de un catálogo en memoria. */
export class InMemoryArticleFetcher implements IArticleFetcher {
  constructor(private readonly catalog: Article[]) {}

  async fetch(url: string): Promise<Article> {
    const found = this.catalog.find((a) => canonicalUrl(a.url) === canonicalUrl(url));
    if (!found) throw new Error("La página no existe o no respondió.");
    return found;
  }
}

/**
 * Trae una nota real y extrae título y texto de forma básica.
 * La descarga se inyecta (DIP): por defecto, con protección SSRF y tope de tamaño, porque
 * las URLs las manda la persona ("/comparar … <links>").
 * En producción conviene un extractor más robusto (Readability, un servicio de extracción):
 * misma interfaz, nada más cambia.
 */
export class HttpArticleFetcher implements IArticleFetcher {
  constructor(
    private readonly outlets: IOutletReader,
    private readonly ids: IIdGenerator,
    private readonly capturer: IPageCapturer = new HttpPageCapturer({ timeoutMs: 10_000 }),
    private readonly maxBytes = 5 * 1024 * 1024,
  ) {}

  async fetch(url: string, topic: string): Promise<Article> {
    const page = await this.capturer.capture(url, this.maxBytes);
    if (page.status >= 400) throw new Error(`La página respondió ${page.status}.`);
    // El cuerpo de la nota (sin menús ni "notas relacionadas"): el mismo extractor que Analizar.
    const art = extractArticle(page.body.toString("utf8"));
    if (!art.text) throw new Error("No se encontró texto de nota en la página.");

    return {
      id: this.ids.next("article"),
      outletId: await resolveOutletId(url, this.outlets),
      url,
      title: art.title ?? url,
      body: art.text,
      publishedAt: art.publishedAt ?? new Date(),
      region: { country: "AR" }, // se refina con un IRegionDetector si hace falta
      topic,
    };
  }
}

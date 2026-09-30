import { ValidationError } from "../../domain/errors";
import type { INewsArticleReader, IPageCapturer, NewsArticleRead } from "../../domain/ports";
import { extractArticle } from "./ArticleExtractor";

/**
 * Lee una nota desde su link: baja la página con el mismo capturador que el archivo de notas
 * (sólo sitios públicos: nada de direcciones internas) y se queda con el cuerpo de la nota.
 */
export class HttpNewsArticleReader implements INewsArticleReader {
  constructor(
    private readonly capturer: IPageCapturer,
    private readonly maxBytes = 3_000_000,
    /** Menos texto que esto no es una nota (una portada, un error, un muro de pago). */
    private readonly minText = 200,
  ) {}

  async read(url: URL): Promise<NewsArticleRead> {
    const page = await this.capturer.capture(url.toString(), this.maxBytes);
    if (page.status >= 400) throw new ValidationError(`El sitio respondió con un error (${page.status}).`);
    if (!/html/i.test(page.mime)) throw new ValidationError("Ese link no es una página de una nota.");
    const a = extractArticle(page.body.toString("utf8"));
    if (a.text.length < this.minText) throw new ValidationError("No pude leer el texto de la nota (puede ser una portada o tener muro de pago).");
    return { url: page.finalUrl, title: a.title, text: a.text, siteName: a.siteName, author: a.author, publishedAt: a.publishedAt };
  }
}

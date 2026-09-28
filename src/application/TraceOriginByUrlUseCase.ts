import { ValidationError } from "../domain/errors";
import type { OriginTrace } from "../domain/model";
import type { IArticleFetcher, IArticleReader, IArticleWriter } from "../domain/ports";
import type { TraceOriginUseCase } from "./TraceOriginUseCase";

/**
 * "¿Quién lo dijo primero?" a partir de un LINK (lo que tiene la persona en la mano).
 * Si la nota ya está guardada se usa esa; si no, se trae (con la protección SSRF del
 * fetcher), se guarda con el tema indicado y se rastrea contra las demás notas del tema.
 */
export class TraceOriginByUrlUseCase {
  constructor(
    private readonly articles: IArticleReader & IArticleWriter,
    private readonly fetcher: IArticleFetcher,
    private readonly trace: TraceOriginUseCase,
  ) {}

  async execute(input: { url: string; topic?: string }): Promise<OriginTrace> {
    const url = input.url.trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new ValidationError("El link no es válido.");
    let article = await this.articles.findByUrl(url);
    if (!article) {
      const topic = input.topic?.trim();
      if (!topic) throw new ValidationError("No tenemos esa nota todavía: indicá de qué tema habla.");
      try {
        article = await this.fetcher.fetch(url, topic);
      } catch (err) {
        throw new ValidationError(`No se pudo leer la nota: ${err instanceof Error ? err.message : String(err)}`);
      }
      await this.articles.saveMany([article]);
    }
    return this.trace.execute({ articleId: article.id });
  }
}

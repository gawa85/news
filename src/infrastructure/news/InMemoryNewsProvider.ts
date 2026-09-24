import { isInPeriod, regionContains, type Article } from "../../domain/model";
import type { INewsSearchProvider, NewsQuery } from "../../domain/ports";
import { normalize } from "../heuristics/text";

/**
 * Proveedor de noticias en memoria, para demo y tests.
 * En producción se agregan adaptadores como NewsApiProvider, RssProvider, GdeltProvider,
 * todos implementando INewsSearchProvider.
 */
export class InMemoryNewsProvider implements INewsSearchProvider {
  constructor(private readonly articles: Article[]) {}

  async search(q: NewsQuery): Promise<Article[]> {
    const topic = normalize(q.topic);
    return this.articles
      .filter((a) => normalize(a.topic).includes(topic))
      .filter((a) => isInPeriod(a.publishedAt, q.period))
      .filter((a) => !q.regions?.length || q.regions.some((r) => regionContains(r, a.region)))
      .slice(0, q.limit ?? 50);
  }
}

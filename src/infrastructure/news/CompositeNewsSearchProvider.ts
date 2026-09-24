import type { Article } from "../../domain/model";
import type { ILogger, INewsSearchProvider, NewsQuery } from "../../domain/ports";

/**
 * Combina varios proveedores de noticias (API, RSS, medios provinciales...) en uno.
 * Para sumar una fuente nueva se agrega un proveedor a la lista (OCP).
 * Si un proveedor falla, se sigue con los demás.
 */
export class CompositeNewsSearchProvider implements INewsSearchProvider {
  constructor(
    private readonly providers: INewsSearchProvider[],
    private readonly logger: ILogger,
  ) {}

  async search(query: NewsQuery): Promise<Article[]> {
    const results = await Promise.allSettled(this.providers.map((p) => p.search(query)));
    const byUrl = new Map<string, Article>();
    results.forEach((r, i) => {
      if (r.status === "fulfilled") r.value.forEach((a) => byUrl.set(a.url, a));
      else this.logger.warn(`Falló el proveedor de noticias #${i}`, { reason: String(r.reason) });
    });
    return [...byUrl.values()];
  }
}

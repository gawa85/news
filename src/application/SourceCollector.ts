import { ValidationError } from "../domain/errors";
import {
  canonicalUrl,
  isValidUrlPattern,
  passesUrlRules,
  type Article,
  type UrlRulesReport,
} from "../domain/model";
import type {
  IArticleFetcher,
  ILogger,
  INewsSearchProvider,
  IOutletReader,
  ISourceSelectionPolicy,
  NewsQuery,
} from "../domain/ports";

export interface CollectedSources {
  articles: Article[];
  report: UrlRulesReport;
}

/** Abstracción: "juntar las notas que van a entrar en un análisis". */
export interface ISourceCollector {
  collect(query: NewsQuery): Promise<CollectedSources>;
}

/**
 * Junta las fuentes para un análisis (SRP: sólo eso):
 *  1. busca notas en los proveedores,
 *  2. aplica las reglas del usuario (`onlyFrom`, `exclude`),
 *  3. aplica la política de diversidad de fuentes,
 *  4. agrega SIEMPRE las URLs que el usuario pidió incluir.
 *
 * Una URL pedida explícitamente en `include` gana sobre `exclude` y sobre la
 * política de diversidad: si el usuario la nombró, la quiere ver.
 */
export class SourceCollector implements ISourceCollector {
  constructor(
    private readonly news: INewsSearchProvider,
    private readonly fetcher: IArticleFetcher,
    private readonly outlets: IOutletReader,
    private readonly selection: ISourceSelectionPolicy,
    private readonly logger: ILogger,
    private readonly maxIncludes = 20,
  ) {}

  async collect(query: NewsQuery): Promise<CollectedSources> {
    const rules = query.urlRules ?? {};
    this.validate(rules);

    // 1 y 2. Búsqueda + filtros del usuario.
    const found = await this.news.search(query);
    const allowed = found.filter((a) => passesUrlRules(a.url, rules));

    // 4 (antes que 3, para no duplicar). Notas pedidas explícitamente.
    const includeUrls = [...new Set((rules.include ?? []).map((u) => u.trim()))];
    const forced: Article[] = [];
    const failedIncludes: UrlRulesReport["failedIncludes"] = [];
    for (const url of includeUrls) {
      const already = found.find((a) => canonicalUrl(a.url) === canonicalUrl(url));
      if (already) {
        forced.push(already);
        continue;
      }
      try {
        forced.push(await this.fetcher.fetch(url, query.topic));
      } catch (err) {
        failedIncludes.push({ url, reason: err instanceof Error ? err.message : String(err) });
        this.logger.warn("No se pudo traer una URL incluida", { url });
      }
    }

    // 3. Diversidad de fuentes sobre el resto.
    const forcedKeys = new Set(forced.map((a) => canonicalUrl(a.url)));
    const rest = allowed.filter((a) => !forcedKeys.has(canonicalUrl(a.url)));
    const selected = this.selection.select(rest, await this.outlets.findAll());

    let articles = [...forced, ...selected];
    if (query.maxOutlets !== undefined) {
      const allowedOutlets = [...new Set(articles.map((a) => a.outletId))].slice(0, query.maxOutlets);
      articles = articles.filter((a) => allowedOutlets.includes(a.outletId));
    }

    return {
      articles,
      report: {
        included: forced.map((a) => a.url),
        failedIncludes,
        filteredOut: found.length - allowed.length,
      },
    };
  }

  private validate(rules: NonNullable<NewsQuery["urlRules"]>): void {
    const all = [...(rules.include ?? []), ...(rules.onlyFrom ?? []), ...(rules.exclude ?? [])];
    const invalid = all.filter((p) => !isValidUrlPattern(p));
    if (invalid.length) throw new ValidationError(`URLs o dominios inválidos: ${invalid.join(", ")}`);
    if ((rules.include?.length ?? 0) > this.maxIncludes) {
      throw new ValidationError(`Se pueden incluir como máximo ${this.maxIncludes} URLs por análisis.`);
    }
  }
}

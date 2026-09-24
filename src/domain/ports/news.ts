import type { Article, Outlet, Period, Region, UrlRules } from "../model";

export interface NewsQuery {
  topic: string;
  period: Period;
  regions?: Region[];
  limit?: number;
  /** URLs a incluir o excluir, definidas por el usuario. */
  urlRules?: UrlRules;
  /** Máximo de medios distintos (límite del plan). Las URLs incluidas entran primero. */
  maxOutlets?: number;
}

/** Cualquier origen de noticias: una API, RSS, scraping, una base propia... */
export interface INewsSearchProvider {
  search(query: NewsQuery): Promise<Article[]>;
}

/** Trae UNA nota puntual a partir de su URL (para las URLs que el usuario pide incluir). */
export interface IArticleFetcher {
  fetch(url: string, topic: string): Promise<Article>;
}

/**
 * Política de selección de fuentes. Es explícita y reemplazable para combatir el
 * sesgo de selección: la comparación sólo es tan buena como las fuentes que entran.
 */
export interface ISourceSelectionPolicy {
  select(articles: Article[], outlets: Outlet[]): Article[];
}

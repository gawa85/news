/**
 * Repositorios separados en LECTURA y ESCRITURA (ISP): un caso de uso que sólo lee
 * no tiene por qué recibir métodos para escribir.
 */
import type { Article, Claim, ClaimVerdict, Outlet, Period } from "../model";

export interface ArticleFilter {
  topic?: string;
  outletId?: string;
  period?: Period;
}

export interface IArticleReader {
  findById(id: string): Promise<Article | undefined>;
  find(filter: ArticleFilter): Promise<Article[]>;
}

export interface IArticleWriter {
  saveMany(articles: Article[]): Promise<void>;
}

export interface IClaimReader {
  findByArticleIds(articleIds: string[]): Promise<Claim[]>;
}

export interface IClaimWriter {
  saveMany(claims: Claim[]): Promise<void>;
}

export interface IVerdictReader {
  findByClaimIds(claimIds: string[]): Promise<ClaimVerdict[]>;
}

export interface IOutletReader {
  findById(id: string): Promise<Outlet | undefined>;
  findAll(): Promise<Outlet[]>;
}

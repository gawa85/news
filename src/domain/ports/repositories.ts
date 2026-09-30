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
  /** La nota guardada con ese link (se compara la URL canónica: sin esquema, "www." ni parámetros de rastreo). */
  findByUrl(url: string): Promise<Article | undefined>;
  /** Las últimas notas de un medio (de la más nueva a la más vieja). */
  latest(outletId: string, limit: number): Promise<Article[]>;
  /** Notas a las que todavía no se les midió el humo. */
  unmeasured(limit: number): Promise<Article[]>;
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

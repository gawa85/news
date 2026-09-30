import type { Article, ArticleSmoke } from "../../domain/model";
import type { IArticleReader, IArticleWriter, ILogger, ISmokeDetector } from "../../domain/ports";

/**
 * HUMO EN LAS NOTAS DEL CATÁLOGO: cada nota que se lee de un feed se mide con el detector
 * que se le pase. En la plataforma es el de REGLAS (gratis y rápido): con IA serían miles de
 * notas por día, cada una con su costo.
 * Las notas que se guardaron antes de medir se completan de a tandas (`backfill`), cada vez que
 * corre la lectura automática de los feeds.
 */
export class CatalogSmokeMeter {
  constructor(
    private readonly detector: ISmokeDetector,
    private readonly articles: IArticleReader & IArticleWriter,
    private readonly logger: ILogger,
  ) {}

  /** La nota con su humo medido (título y texto). */
  async measure(a: Article): Promise<Article> {
    const r = await this.detector.analyze(`${a.title}. ${a.body}`);
    const smoke: ArticleSmoke = {
      index: Math.max(0, Math.min(100, Math.round(r.smokeIndex))),
      types: [...new Set(r.findings.map((f) => f.type))],
      version: this.detector.version ?? "sin-version",
    };
    return { ...a, smoke };
  }

  /** Mide hasta `limit` notas que todavía no tienen humo medido. Devuelve cuántas midió. */
  async backfill(limit = 500): Promise<number> {
    const pending = await this.articles.unmeasured(limit);
    const done: Article[] = [];
    for (const a of pending) {
      try {
        done.push(await this.measure(a));
      } catch (err) {
        this.logger.warn("No se pudo medir el humo de una nota", { articleId: a.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    await this.articles.saveMany(done);
    return done.length;
  }
}

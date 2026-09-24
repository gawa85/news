import type { IArticleWriter, IClaimExtractor, IClaimWriter, ILogger, NewsQuery } from "../domain/ports";
import type { ISourceCollector } from "./SourceCollector";

/**
 * Caso de uso 6: ingesta periódica (p. ej. cada hora, como tarea programada).
 * Guarda notas y afirmaciones aunque nadie las haya pedido todavía: ese historial
 * es lo que después permite medir credibilidad por tema y período.
 */
export class IngestArticlesUseCase {
  constructor(
    private readonly sources: ISourceCollector,
    private readonly extractor: IClaimExtractor,
    private readonly articleWriter: IArticleWriter,
    private readonly claimWriter: IClaimWriter,
    private readonly logger: ILogger,
  ) {}

  async execute(query: NewsQuery): Promise<{ articles: number; claims: number }> {
    const { articles } = await this.sources.collect(query);
    const claims = (await Promise.all(articles.map((a) => this.extractor.extract(a)))).flat();
    await this.articleWriter.saveMany(articles);
    await this.claimWriter.saveMany(claims);
    this.logger.info("Ingesta realizada", { topic: query.topic, articles: articles.length, claims: claims.length });
    return { articles: articles.length, claims: claims.length };
  }
}

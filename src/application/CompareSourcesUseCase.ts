import { InsufficientDataError, ValidationError } from "../domain/errors";
import type { ClaimCluster, Omission, SourceComparison } from "../domain/model";
import type {
  IArticleWriter,
  IClaimClusterer,
  IClaimExtractor,
  IClaimWriter,
  IDisagreementClassifier,
  ILogger,
  NewsQuery,
} from "../domain/ports";
import type { ISourceCollector } from "./SourceCollector";

/**
 * Caso de uso 2: comparar cómo cuentan el mismo tema distintas fuentes.
 *
 * Orquesta pasos; NO sabe cómo se buscan las notas, cómo se aplican las reglas de URL,
 * cómo se extraen afirmaciones ni cómo se agrupan. Todo llega por interfaces (DIP).
 */
export class CompareSourcesUseCase {
  constructor(
    private readonly sources: ISourceCollector,
    private readonly extractor: IClaimExtractor,
    private readonly clusterer: IClaimClusterer,
    private readonly classifier: IDisagreementClassifier,
    private readonly articleWriter: IArticleWriter,
    private readonly claimWriter: IClaimWriter,
    private readonly logger: ILogger,
  ) {}

  async execute(query: NewsQuery): Promise<SourceComparison> {
    if (!query.topic.trim()) throw new ValidationError("Falta el tema a comparar.");

    // 1. Juntar fuentes (búsqueda + URLs incluidas/excluidas + diversidad).
    const { articles, report } = await this.sources.collect(query);
    const outletIds = unique(articles.map((a) => a.outletId));
    if (outletIds.length < 2) {
      throw new InsufficientDataError(
        `Se necesitan al menos 2 fuentes distintas sobre "${query.topic}" (hay ${outletIds.length}).`,
      );
    }

    // 2. Extraer afirmaciones concretas de cada artículo.
    const claims = (await Promise.all(articles.map((a) => this.extractor.extract(a)))).flat();

    // Se guarda todo desde el día uno: es el historial que alimenta el medidor de credibilidad.
    await this.articleWriter.saveMany(articles);
    await this.claimWriter.saveMany(claims);

    // 3. Agrupar afirmaciones equivalentes y detectar desacuerdos.
    const clusters = await this.clusterer.cluster(claims);
    const disagreements = await this.classifier.classify(clusters);
    const disputed = new Set(disagreements.map((d) => d.clusterId));

    const undisputed = clusters.filter((c) => !disputed.has(c.id));
    const result: SourceComparison = {
      topic: query.topic,
      outletIds,
      articleUrls: articles.map((a) => a.url),
      urlRules: report,
      agreements: undisputed.filter((c) => c.outletIds.length === outletIds.length),
      partialAgreements: undisputed.filter((c) => c.outletIds.length > 1 && c.outletIds.length < outletIds.length),
      disagreements,
      omissions: findOmissions(clusters, outletIds),
      openQuestions: disagreements
        .filter((d) => d.type === "factual")
        .map((d) => `Dato en disputa, verificar con fuente primaria: ${d.description}`),
    };

    this.logger.info("Comparación de fuentes realizada", {
      topic: query.topic,
      articles: articles.length,
      claims: claims.length,
      clusters: clusters.length,
      disagreements: disagreements.length,
    });
    return result;
  }
}

/** Una fuente "omite" un punto cuando al menos otras dos lo mencionan y ella no. */
function findOmissions(clusters: ClaimCluster[], outletIds: string[]): Omission[] {
  return outletIds
    .map((outletId) => ({
      outletId,
      missingClusterIds: clusters
        .filter((c) => c.outletIds.length >= 2 && !c.outletIds.includes(outletId))
        .map((c) => c.id),
    }))
    .filter((o) => o.missingClusterIds.length > 0);
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

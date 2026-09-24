import { NotFoundError, ValidationError } from "../domain/errors";
import type { CredibilityQuery, CredibilityReport } from "../domain/model";
import type {
  EvaluationContext,
  IAggregationPolicy,
  IArticleReader,
  IClaimReader,
  IClock,
  ICredibilityDimension,
  ICredibilityEvaluator,
  IOutletReader,
} from "../domain/ports";

const DISCLAIMER =
  "La credibilidad se mide por tema y período, no es una nota fija del medio. " +
  "Tener una línea editorial clara no es lo mismo que ser inexacto. " +
  "Los indicadores de contexto (dueños, pauta, cambios de postura) señalan riesgos, no prueban mala fe.";

/**
 * Caso de uso 4: medidor de credibilidad.
 * Recibe una LISTA de dimensiones: agregar una nueva no requiere modificar esta clase (OCP).
 */
export class EvaluateCredibilityUseCase implements ICredibilityEvaluator {
  constructor(
    private readonly outlets: IOutletReader,
    private readonly articles: IArticleReader,
    private readonly claims: IClaimReader,
    private readonly dimensions: ICredibilityDimension[],
    private readonly aggregation: IAggregationPolicy,
    private readonly clock: IClock,
  ) {}

  async evaluate(query: CredibilityQuery): Promise<CredibilityReport> {
    if (query.period.from > query.period.to) throw new ValidationError("El período es inválido.");

    const outlet = await this.outlets.findById(query.outletId);
    if (!outlet) throw new NotFoundError(`No existe el medio ${query.outletId}.`);

    const articles = await this.articles.find({ outletId: outlet.id, topic: query.topic, period: query.period });
    const claims = await this.claims.findByArticleIds(articles.map((a) => a.id));
    const ctx: EvaluationContext = { query, outlet, articles, claims };

    const dimensions = await Promise.all(this.dimensions.map((d) => d.evaluate(ctx)));

    return {
      query,
      outletName: outlet.name,
      dimensions,
      overall: this.aggregation.aggregate(dimensions),
      sampleSize: articles.length,
      generatedAt: this.clock.now(),
      disclaimer: DISCLAIMER,
    };
  }
}

import type { DimensionScore } from "../../domain/model";
import type {
  EvaluationContext,
  ICredibilityDimension,
  IPoliticalContextProvider,
  IStanceDetector,
} from "../../domain/ports";

/**
 * Coherencia en el tiempo: ¿cambió la postura del medio sobre el tema cuando cambió
 * el gobierno? Un cambio no prueba nada (puede haber razones), pero es una señal.
 */
export class ConsistencyDimension implements ICredibilityDimension {
  readonly id = "consistency";
  readonly label = "Coherencia ante cambios políticos";

  constructor(
    private readonly politics: IPoliticalContextProvider,
    private readonly stance: IStanceDetector,
    private readonly minArticlesPerSide = 1,
  ) {}

  async evaluate(ctx: EvaluationContext): Promise<DimensionScore> {
    const region = ctx.query.region ?? ctx.outlet.region;
    const context = await this.politics.contextFor(region, ctx.query.period);
    const change = context.events.find((e) => e.kind === "government_change");

    if (!change) {
      return this.result(null, 0, "No hubo cambio de gobierno en el período: no se puede evaluar.", []);
    }

    const before = ctx.articles.filter((a) => a.publishedAt < change.date);
    const after = ctx.articles.filter((a) => a.publishedAt >= change.date);
    if (before.length < this.minArticlesPerSide || after.length < this.minArticlesPerSide) {
      return this.result(null, 0, `Pocas notas antes y después de: ${change.description}.`, []);
    }

    const avg = async (xs: typeof before) =>
      (await Promise.all(xs.map((a) => this.stance.stance(a, ctx.query.topic)))).reduce((s, v) => s + v, 0) / xs.length;
    const sBefore = await avg(before);
    const sAfter = await avg(after);
    const shift = Math.abs(sAfter - sBefore) / 2; // 0 a 1

    return this.result(
      Math.round((1 - shift) * 100) / 100,
      Math.min(1, (before.length + after.length) / 20),
      `Postura promedio antes de "${change.description}": ${fmt(sBefore)}; después: ${fmt(sAfter)}.`,
      [{ description: `Cambio de postura de ${fmt(sAfter - sBefore)} tras ${change.description}` }],
    );
  }

  private result(score: number | null, confidence: number, summary: string, evidence: DimensionScore["evidence"]): DimensionScore {
    return { dimensionId: this.id, label: this.label, score, confidence, summary, evidence };
  }
}

const fmt = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);

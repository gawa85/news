import type { DimensionScore } from "../../domain/model";
import type { EvaluationContext, ICredibilityDimension, IVerdictReader } from "../../domain/ports";

/** Exactitud: de las afirmaciones verificadas después, ¿cuántas se confirmaron? */
export class AccuracyDimension implements ICredibilityDimension {
  readonly id = "accuracy";
  readonly label = "Exactitud verificable";

  constructor(private readonly verdicts: IVerdictReader) {}

  async evaluate(ctx: EvaluationContext): Promise<DimensionScore> {
    const factIds = ctx.claims.filter((c) => c.kind === "fact").map((c) => c.id);
    const verdicts = await this.verdicts.findByClaimIds(factIds);
    const confirmed = verdicts.filter((v) => v.status === "confirmed").length;
    const refuted = verdicts.filter((v) => v.status === "refuted").length;
    const n = confirmed + refuted;

    return {
      dimensionId: this.id,
      label: this.label,
      score: n === 0 ? null : confirmed / n,
      confidence: Math.min(1, n / 10),
      summary:
        n === 0
          ? "Todavía no hay afirmaciones verificadas de este medio sobre el tema."
          : `${confirmed} confirmadas y ${refuted} desmentidas de ${n} verificadas.`,
      evidence: verdicts
        .filter((v) => v.status === "refuted")
        .map((v) => ({ description: `Afirmación desmentida (${v.claimId})`, url: v.evidenceUrl })),
    };
  }
}

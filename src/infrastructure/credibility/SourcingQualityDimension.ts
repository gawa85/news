import type { DimensionScore } from "../../domain/model";
import type { EvaluationContext, ICredibilityDimension } from "../../domain/ports";

/** Calidad de fuentes: ¿cita fuentes con nombre y documentos, o "trascendidos"? */
export class SourcingQualityDimension implements ICredibilityDimension {
  readonly id = "sourcing";
  readonly label = "Calidad de las fuentes";

  async evaluate(ctx: EvaluationContext): Promise<DimensionScore> {
    const facts = ctx.claims.filter((c) => c.kind === "fact");
    const n = facts.length;
    const count = (a: string) => facts.filter((c) => c.attribution === a).length;
    const named = count("named");
    const docs = count("official_document");
    const anonymous = count("anonymous");

    return {
      dimensionId: this.id,
      label: this.label,
      // Fuente con nombre o documento = 1; sin atribución = 0,3; anónima = 0.
      score: n === 0 ? null : (named + docs + 0.3 * count("none")) / n,
      confidence: Math.min(1, n / 20),
      summary:
        n === 0
          ? "No hay afirmaciones de hecho para evaluar."
          : `${named} con fuente identificada, ${docs} con documento oficial, ${anonymous} anónimas, ${count("none")} sin atribución (de ${n}).`,
      evidence: facts
        .filter((c) => c.attribution === "anonymous")
        .map((c) => ({ description: `Fuente anónima: "${c.text}"`, articleId: c.articleId })),
    };
  }
}

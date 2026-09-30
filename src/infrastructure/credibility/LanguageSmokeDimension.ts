import { SMOKE_LABELS, type DimensionScore, type SmokeType } from "../../domain/model";
import type { EvaluationContext, ICredibilityDimension } from "../../domain/ports";

/**
 * Humo en el lenguaje: ¿las notas del medio sobre el tema informan, o inflan, alarman y venden?
 * Usa el humo medido en cada nota (reglas). No mide si lo que dicen es cierto: eso es "exactitud".
 */
export class LanguageSmokeDimension implements ICredibilityDimension {
  readonly id = "language";
  readonly label = "Humo en el lenguaje";

  async evaluate(ctx: EvaluationContext): Promise<DimensionScore> {
    const measured = ctx.articles.filter((a) => a.smoke);
    const n = measured.length;
    if (n === 0) {
      return { dimensionId: this.id, label: this.label, score: null, confidence: 0, summary: "Todavía no hay notas con el humo medido.", evidence: [] };
    }
    const average = measured.reduce((s, a) => s + a.smoke!.index, 0) / n;
    const count = new Map<SmokeType, number>();
    for (const a of measured) for (const t of a.smoke!.types) count.set(t, (count.get(t) ?? 0) + 1);
    const common = [...count].sort((a, b) => b[1] - a[1]).slice(0, 2);
    const worst = [...measured].sort((a, b) => b.smoke!.index - a.smoke!.index).filter((a) => a.smoke!.index >= 40).slice(0, 3);

    return {
      dimensionId: this.id,
      label: this.label,
      score: Math.round((1 - average / 100) * 100) / 100,
      confidence: Math.min(1, n / 20),
      summary:
        `Humo promedio: ${Math.round(average)} de 100 en ${n} nota${n === 1 ? "" : "s"}.` +
        (common.length ? ` Lo más común: ${common.map(([t, k]) => `${SMOKE_LABELS[t].toLowerCase()} (${k})`).join(", ")}.` : " No se encontró humo."),
      evidence: worst.map((a) => ({ description: `Humo ${a.smoke!.index}/100: "${a.title}"`, articleId: a.id })),
    };
  }
}

import type { Claim, DimensionScore } from "../../domain/model";
import type { EvaluationContext, IArticleReader, IClaimIndex, IClaimIndexer, IClaimReader, ICredibilityDimension } from "../../domain/ports";
import { figuresAgree, figuresDisagree, isCheckable } from "../../domain/rules/figures";

/** Qué pasó con un dato del medio al compararlo con los demás. */
export type CrossCheck = "same" | "different" | "unclear" | "copy" | "alone";

/**
 * Cotejo de un dato con cifras contra lo que publicaron OTROS medios sobre lo mismo:
 * "same" otro medio da la misma cifra; "different" otros dan otro porcentaje o monto; "copy" sólo aparece
 * copiado textual (la misma fuente, no corrobora nada); "unclear" otros hablan de lo mismo pero sin
 * cifras comparables; "alone" ningún otro medio lo publicó.
 */
export function crossCheck(claim: Claim, others: IClaimIndex): { result: CrossCheck; with: Claim[] } {
  const related = others.related(claim).filter((r) => r.claim.outletId !== claim.outletId);
  if (!related.length) return { result: "alone", with: [] };
  const independent = related.filter((r) => !r.copy).map((r) => r.claim);
  if (!independent.length) return { result: "copy", with: related.map((r) => r.claim) };
  const same = independent.filter((o) => figuresAgree(claim, o));
  if (same.length) return { result: "same", with: same };
  // "Distinta" sólo si comparan lo comparable (porcentaje con porcentaje, monto con monto).
  const different = independent.filter((o) => figuresDisagree(claim, o));
  return different.length ? { result: "different", with: different } : { result: "unclear", with: independent };
}

/** Desde qué parte de sus datos cotejados el cotejo dice algo firme del medio. */
export const COVERAGE_FOR_FULL_CONFIDENCE = 0.3;

/**
 * Cotejo entre medios: los datos con cifras del medio, ¿los publican otros medios igual?
 * No es una verificación (varios medios pueden repetir el mismo error), pero es una
 * corroboración: una cifra que nadie más da, o que otros dan distinta, pide revisarse.
 */
export class CorroborationDimension implements ICredibilityDimension {
  readonly id = "corroboration";
  readonly label = "Cotejo con otros medios";

  constructor(
    private readonly articles: IArticleReader,
    private readonly claims: IClaimReader,
    private readonly indexer: IClaimIndexer,
    private readonly names: (outletId: string) => Promise<string>,
  ) {}

  async evaluate(ctx: EvaluationContext): Promise<DimensionScore> {
    const mine = ctx.claims.filter(isCheckable);
    if (!mine.length) {
      return { dimensionId: this.id, label: this.label, score: null, confidence: 0, summary: "No hay datos con cifras para cotejar.", evidence: [] };
    }
    const otherArticles = (await this.articles.find({ topic: ctx.query.topic || undefined, period: ctx.query.period })).filter((a) => a.outletId !== ctx.outlet.id);
    const others = otherArticles.length ? (await this.claims.findByArticleIds(otherArticles.map((a) => a.id))).filter(isCheckable) : [];
    const index = this.indexer.index(others);

    const count: Record<CrossCheck, number> = { same: 0, different: 0, unclear: 0, copy: 0, alone: 0 };
    const conflicts: { claim: Claim; with: Claim[] }[] = [];
    for (const c of mine) {
      const r = crossCheck(c, index);
      count[r.result]++;
      if (r.result === "different") conflicts.push({ claim: c, with: r.with });
    }
    const checked = count.same + count.different;
    const n = mine.length;
    // Qué parte de sus datos se pudo cotejar: 16 de 2.000 no alcanza para decir nada del medio.
    const coverage = checked / n;
    const evidence = [];
    for (const x of conflicts.slice(0, 5)) {
      const o = x.with[0]!;
      evidence.push({ description: `Cifra distinta: "${x.claim.text}" — ${await this.names(o.outletId)} dice: "${o.text}"`, articleId: x.claim.articleId });
    }
    return {
      dimensionId: this.id,
      label: this.label,
      score: checked === 0 ? null : Math.round((count.same / checked) * 100) / 100,
      confidence: Math.round(Math.min(1, checked / 10) * Math.min(1, coverage / COVERAGE_FOR_FULL_CONFIDENCE) * 100) / 100,
      summary:
        `De ${n} dato${n === 1 ? "" : "s"} con cifras: ${count.same} también los publica otro medio con la misma cifra, ` +
        `${count.different} otros medios los dan con cifras distintas, ${count.unclear} otros medios hablan de lo mismo sin cifras comparables, ` +
        `${count.copy} sólo aparecen copiados textual (la misma fuente) ` +
        `y ${count.alone} no los publica nadie más (sin cotejar). Se pudo cotejar el ${Math.round(coverage * 100)} % de sus datos.`,
      evidence,
    };
  }
}

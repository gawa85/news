import { ValidationError } from "../../domain/errors";
import type { Claim, DimensionScore, Period } from "../../domain/model";
import type { VerificationState } from "../../domain/rules/credibilityVerification";
import type { IArticleReader, IClaimIndexer, IClaimReader, ICredibilityEvaluator, IOutletReader, IVerdictReader } from "../../domain/ports";
import { figuresDisagree, figuresOf, isCheckable } from "../../domain/rules/figures";

export interface OverviewQuery {
  /** Vacío = todos los temas. */
  topic?: string;
  period: Period;
}

export interface OverviewRow {
  outletId: string;
  outletName: string;
  articles: number;
  overall: number | null;
  verification: VerificationState;
  /** Las dimensiones que se comparan de un vistazo (el detalle está en la ficha de cada medio). */
  dimensions: Pick<DimensionScore, "dimensionId" | "label" | "score" | "confidence" | "summary">[];
}

/** Un dato con cifras que publicaron varios medios y nadie verificó. */
export interface ClaimToVerify {
  text: string;
  outlets: string[];
  /** Los medios no dan la misma cifra. */
  conflicting: boolean;
  numbers: number[];
}

export interface CredibilityOverview {
  query: OverviewQuery;
  rows: OverviewRow[];
  /** Los datos más repetidos sin verificar: por dónde conviene empezar a corroborar. */
  toVerify: ClaimToVerify[];
  totals: { articles: number; factClaims: number; verifiedClaims: number };
  generatedAt: Date;
}

/**
 * PANORAMA DE CREDIBILIDAD: todos los medios con notas en el período (y el tema, si se elige),
 * lado a lado, con cuánto de lo que publican está corroborado. Más la lista de los datos que
 * más se repiten entre medios y nadie verificó: que estén en muchas notas no los hace ciertos.
 */
export class CredibilityOverviewUseCase {
  constructor(
    private readonly outlets: IOutletReader,
    private readonly articles: IArticleReader,
    private readonly claims: IClaimReader,
    private readonly verdicts: IVerdictReader,
    private readonly evaluator: ICredibilityEvaluator,
    private readonly indexer: IClaimIndexer,
    private readonly maxOutlets = 60,
  ) {}

  async execute(query: OverviewQuery): Promise<CredibilityOverview> {
    if (query.period.from > query.period.to) throw new ValidationError("El período es inválido.");
    const topic = query.topic?.trim() || undefined;
    const articles = await this.articles.find({ topic, period: query.period });
    const perOutlet = new Map<string, number>();
    for (const a of articles) perOutlet.set(a.outletId, (perOutlet.get(a.outletId) ?? 0) + 1);
    const ids = [...perOutlet.keys()].sort((a, b) => perOutlet.get(b)! - perOutlet.get(a)!).slice(0, this.maxOutlets);

    const rows: OverviewRow[] = [];
    for (const outletId of ids) {
      const r = await this.evaluator.evaluate({ outletId, topic: topic ?? "", period: query.period });
      rows.push({
        outletId,
        outletName: r.outletName,
        articles: perOutlet.get(outletId)!,
        overall: r.overall,
        verification: r.verification,
        dimensions: r.dimensions.map(({ dimensionId, label, score, confidence, summary }) => ({ dimensionId, label, score, confidence, summary })),
      });
    }

    const all = articles.length ? await this.claims.findByArticleIds(articles.map((a) => a.id)) : [];
    const facts = all.filter((c) => c.kind === "fact");
    const verdicts = facts.length ? await this.verdicts.findByClaimIds(facts.map((c) => c.id)) : [];
    const verified = new Set(verdicts.filter((v) => v.status === "confirmed" || v.status === "refuted").map((v) => v.claimId));
    const names = new Map((await this.outlets.findAll()).map((o) => [o.id, o.name]));

    return {
      query: { topic, period: query.period },
      rows,
      toVerify: this.mostRepeated(facts.filter((c) => isCheckable(c) && !verified.has(c.id)), names),
      totals: { articles: articles.length, factClaims: facts.length, verifiedClaims: verified.size },
      generatedAt: new Date(),
    };
  }

  /** Agrupa los datos que hablan de lo mismo y se queda con los que publicaron más medios distintos. */
  private mostRepeated(claims: Claim[], names: Map<string, string>, limit = 10): ClaimToVerify[] {
    // Grupos por "habla de lo mismo" (unión de pares relacionados).
    const parent = new Map(claims.map((c) => [c.id, c.id]));
    const root = (id: string): string => {
      let r = id;
      while (parent.get(r) !== r) r = parent.get(r)!;
      parent.set(id, r);
      return r;
    };
    const index = this.indexer.index(claims);
    for (const c of claims) for (const r of index.related(c)) parent.set(root(r.claim.id), root(c.id));
    const groups = new Map<string, Claim[]>();
    for (const c of claims) (groups.get(root(c.id)) ?? groups.set(root(c.id), []).get(root(c.id))!).push(c);

    return [...groups.values()]
      .map((g) => ({ g, outlets: [...new Set(g.map((c) => c.outletId))] }))
      .filter((x) => x.outlets.length >= 2)
      .sort((a, b) => b.outlets.length - a.outlets.length || b.g.length - a.g.length)
      .slice(0, limit)
      .map(({ g, outlets }) => {
        const main = new Set(g.map((c) => figuresOf(c)[0]).filter((n): n is number => n !== undefined));
        // Cifras distintas: dos medios distintos que dan otro porcentaje u otro monto sobre lo mismo.
        const conflicting = g.some((a) => g.some((b) => a.outletId !== b.outletId && figuresDisagree(a, b)));
        // Un texto representativo: el más corto que tenga sentido solo.
        const shortest = g.reduce((a, b) => (b.text.length < a.text.length ? b : a));
        return { text: shortest.text.replace(/\s+/g, " ").trim(), outlets: outlets.map((id) => names.get(id) ?? id), conflicting, numbers: [...main] };
      });
  }
}

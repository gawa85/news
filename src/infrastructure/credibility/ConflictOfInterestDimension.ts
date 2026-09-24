import type { DimensionScore } from "../../domain/model";
import type {
  EvaluationContext,
  ICredibilityDimension,
  IOwnershipRegistry,
  ITopicSectorMapper,
} from "../../domain/ports";

/**
 * Conflicto de interés: ¿los dueños del medio (en ESE período) tienen negocios
 * en el sector que toca el tema? Puntaje alto = sin conflicto detectado.
 */
export class ConflictOfInterestDimension implements ICredibilityDimension {
  readonly id = "conflict_of_interest";
  readonly label = "Conflicto de interés (dueños)";

  constructor(
    private readonly ownership: IOwnershipRegistry,
    private readonly sectors: ITopicSectorMapper,
  ) {}

  async evaluate(ctx: EvaluationContext): Promise<DimensionScore> {
    const owners = await this.ownership.ownersAt(ctx.outlet.id, ctx.query.period.to);
    const topicSectors = this.sectors.sectorsFor(ctx.query.topic);

    if (owners.length === 0) {
      return this.result(null, 0, "No hay datos de propiedad del medio para el período.", []);
    }

    const conflicts = owners
      .map((o) => ({ owner: o, overlap: o.businessSectors.filter((s) => topicSectors.includes(s)) }))
      .filter((x) => x.overlap.length > 0);

    return this.result(
      conflicts.length ? 0.3 : 1,
      topicSectors.length ? 0.8 : 0.4,
      conflicts.length
        ? `Dueños con negocios en el sector del tema: ${conflicts.map((c) => `${c.owner.name} (${c.overlap.join(", ")})`).join("; ")}.`
        : `Dueños: ${owners.map((o) => o.name).join(", ")}; sin negocios detectados en el sector del tema.`,
      conflicts.map((c) => ({ description: `${c.owner.name} tiene negocios en ${c.overlap.join(", ")}` })),
    );
  }

  private result(score: number | null, confidence: number, summary: string, evidence: DimensionScore["evidence"]): DimensionScore {
    return { dimensionId: this.id, label: this.label, score, confidence, summary, evidence };
  }
}

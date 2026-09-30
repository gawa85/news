import { monthsInPeriod, type DimensionScore } from "../../domain/model";
import type {
  EvaluationContext,
  ICredibilityDimension,
  IOfficialAdvertisingSource,
  IPoliticalContextProvider,
} from "../../domain/ports";

export interface AdvertisingThresholds {
  /** Monto mensual a partir del cual se considera dependencia alta. */
  highMonthlyAmount: number;
  currency: string;
}

/**
 * Dependencia de la pauta oficial. Cruza quién paga con quién gobierna:
 * cubrir al gobierno que te financia es un riesgo que el lector tiene que conocer.
 */
export class OfficialAdvertisingDimension implements ICredibilityDimension {
  readonly id = "official_advertising";
  readonly label = "Dependencia de pauta oficial";

  constructor(
    private readonly ads: IOfficialAdvertisingSource,
    private readonly politics: IPoliticalContextProvider,
    private readonly thresholds: AdvertisingThresholds,
  ) {}

  async evaluate(ctx: EvaluationContext): Promise<DimensionScore> {
    const { period } = ctx.query;
    const spends = (await this.ads.spendFor(ctx.outlet.id, period)).filter(
      (s) => s.currency === this.thresholds.currency,
    );
    const region = ctx.query.region ?? ctx.outlet.region;
    const context = await this.politics.contextFor(region, period);

    const total = spends.reduce((sum, s) => sum + s.amount, 0);
    const monthly = total / monthsInPeriod(period);
    const score = 1 - Math.min(1, monthly / this.thresholds.highMonthlyAmount);

    const payers = [...new Set(spends.map((s) => `${s.payer} (${s.jurisdiction})`))];
    const governing = context.governingForces.map((g) => `${g.name} (${g.jurisdiction})`);

    return {
      dimensionId: this.id,
      label: this.label,
      // Sin datos no se sabe: no es lo mismo que "no recibe pauta" (antes contaba como perfecto).
      score: spends.length === 0 ? null : round(score),
      confidence: spends.length === 0 ? 0 : 0.8,
      summary:
        spends.length === 0
          ? "No hay datos de pauta oficial para el período: no se puede evaluar."
          : `Promedio mensual de ${Math.round(monthly).toLocaleString("es-AR")} ${this.thresholds.currency}. ` +
            `Pagan: ${payers.join(", ")}. Gobiernan en la zona: ${governing.join(", ") || "sin datos"}.`,
      evidence: spends.map((s) => ({
        description: `${s.payer}: ${s.amount.toLocaleString("es-AR")} ${s.currency}`,
      })),
    };
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

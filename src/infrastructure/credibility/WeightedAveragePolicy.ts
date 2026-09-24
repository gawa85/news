import type { DimensionScore } from "../../domain/model";
import type { IAggregationPolicy } from "../../domain/ports";

/** Promedio ponderado por peso de la dimensión × confianza. Ignora dimensiones sin datos. */
export class WeightedAveragePolicy implements IAggregationPolicy {
  constructor(private readonly weights: Record<string, number>) {}

  aggregate(scores: DimensionScore[]): number | null {
    let sum = 0;
    let total = 0;
    for (const s of scores) {
      if (s.score === null) continue;
      const w = (this.weights[s.dimensionId] ?? 1) * s.confidence;
      sum += s.score * w;
      total += w;
    }
    return total === 0 ? null : Math.round((sum / total) * 100) / 100;
  }
}

/** Alternativa: no dar ningún número resumen, sólo el desglose. Mismo contrato (LSP). */
export class NoAggregationPolicy implements IAggregationPolicy {
  aggregate(): number | null {
    return null;
  }
}

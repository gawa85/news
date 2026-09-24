import { ValidationError } from "../domain/errors";
import type { CredibilityQuery, CredibilityTimelinePoint, Period } from "../domain/model";
import type { ICredibilityEvaluator } from "../domain/ports";

/**
 * Caso de uso 5: evolución de la credibilidad de un medio en un tema a lo largo del tiempo.
 * Depende de la ABSTRACCIÓN ICredibilityEvaluator, no de EvaluateCredibilityUseCase:
 * se puede reemplazar por una versión con caché sin tocar esta clase (DIP).
 */
export class CredibilityTimelineUseCase {
  constructor(private readonly evaluator: ICredibilityEvaluator) {}

  async execute(query: CredibilityQuery, windows: number): Promise<CredibilityTimelinePoint[]> {
    if (windows < 1 || windows > 60) throw new ValidationError("La cantidad de ventanas debe estar entre 1 y 60.");

    const periods = splitPeriod(query.period, windows);
    return Promise.all(
      periods.map(async (period) => ({ period, report: await this.evaluator.evaluate({ ...query, period }) })),
    );
  }
}

function splitPeriod(p: Period, n: number): Period[] {
  const step = (p.to.getTime() - p.from.getTime()) / n;
  return Array.from({ length: n }, (_, i) => ({
    from: new Date(p.from.getTime() + step * i),
    to: new Date(p.from.getTime() + step * (i + 1) - (i < n - 1 ? 1 : 0)),
  }));
}

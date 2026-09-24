/**
 * OCP en acción: se agrega una dimensión de credibilidad NUEVA (definida acá mismo)
 * sin modificar EvaluateCredibilityUseCase.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { EvaluateCredibilityUseCase } from "../src/application/EvaluateCredibilityUseCase";
import type { DimensionScore } from "../src/domain/model";
import type { EvaluationContext, ICredibilityDimension } from "../src/domain/ports";
import { WeightedAveragePolicy } from "../src/infrastructure/credibility/WeightedAveragePolicy";
import { createMemoryStore } from "../src/infrastructure/persistence/stores";
import { FixedClock } from "../src/infrastructure/system/System";

class CorrectionsDimension implements ICredibilityDimension {
  readonly id = "corrections";
  readonly label = "Publica correcciones";
  async evaluate(_: EvaluationContext): Promise<DimensionScore> {
    return { dimensionId: this.id, label: this.label, score: 0.9, confidence: 1, summary: "ok", evidence: [] };
  }
}

class NoDataDimension implements ICredibilityDimension {
  readonly id = "nodata";
  readonly label = "Sin datos";
  async evaluate(): Promise<DimensionScore> {
    return { dimensionId: this.id, label: this.label, score: null, confidence: 0, summary: "", evidence: [] };
  }
}

test("el motor acepta dimensiones nuevas sin cambios y las que no tienen datos no afectan el resumen", async () => {
  const { repos } = createMemoryStore();
  await repos.outlets.save({ id: "m", name: "Medio", url: "https://m.example", kind: "digital", region: { country: "AR" } });
  const uc = new EvaluateCredibilityUseCase(
    repos.outlets,
    repos.articles,
    repos.claims,
    [new CorrectionsDimension(), new NoDataDimension()],
    new WeightedAveragePolicy({}),
    new FixedClock(new Date("2026-09-23")),
  );
  const r = await uc.evaluate({ outletId: "m", topic: "gas", period: { from: new Date("2026-01-01"), to: new Date("2026-02-01") } });
  assert.equal(r.dimensions.length, 2);
  assert.equal(r.overall, 0.9);
});

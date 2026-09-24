import type { ClaimCluster, Disagreement } from "../../domain/model";
import type { IDisagreementClassifier } from "../../domain/ports";
import { polarity } from "./text";

/**
 * Detecta desacuerdos dentro de cada grupo de afirmaciones:
 * - factual: las fuentes dan números distintos para lo mismo.
 * - interpretive: interpretaciones con polaridad opuesta.
 * - values: sólo lo detecta bien un modelo de IA (ver LLMDisagreementClassifier).
 */
export class RuleBasedDisagreementClassifier implements IDisagreementClassifier {
  async classify(clusters: ClaimCluster[]): Promise<Disagreement[]> {
    const result: Disagreement[] = [];
    for (const cluster of clusters) {
      if (cluster.outletIds.length < 2) continue;

      const facts = cluster.claims.filter((c) => c.kind === "fact" && c.numbers.length > 0);
      // Cifra principal de cada fuente → cuántas fuentes respaldan cada cifra.
      const byNumber = new Map<number, Set<string>>();
      for (const c of facts) {
        const n = c.numbers[0]!;
        byNumber.set(n, (byNumber.get(n) ?? new Set()).add(c.outletId));
      }
      if (new Set(facts.map((c) => c.outletId)).size >= 2 && byNumber.size >= 2) {
        const versions = [...byNumber.entries()]
          .sort((a, b) => b[1].size - a[1].size)
          .map(([n, outlets]) => `${n} (${outlets.size} fuente${outlets.size > 1 ? "s" : ""})`);
        const shortest = facts.reduce((a, b) => (b.text.length < a.text.length ? b : a));
        result.push({
          type: "factual",
          clusterId: cluster.id,
          description: `cifras distintas: ${versions.join(" vs ")}, sobre "${shortest.text}"`,
          positions: facts.map((c) => ({ outletId: c.outletId, claimText: c.text, claimId: c.id })),
        });
        continue;
      }

      const interp = cluster.claims.filter((c) => c.kind === "interpretation");
      const pols = interp.map((c) => polarity(c.text));
      if (pols.some((p) => p > 0) && pols.some((p) => p < 0)) {
        result.push({
          type: "interpretive",
          clusterId: cluster.id,
          description: "mismo hecho, lecturas opuestas",
          positions: interp.map((c) => ({ outletId: c.outletId, claimText: c.text })),
        });
      }
    }
    return result;
  }
}

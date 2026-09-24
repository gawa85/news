import type { Claim, ClaimCluster } from "../../domain/model";
import type { IClaimClusterer, IIdGenerator, ITextSimilarity } from "../../domain/ports";

/**
 * Agrupa afirmaciones parecidas. Depende de ITextSimilarity (abstracción),
 * así que cambiar Jaccard por embeddings no requiere tocar esta clase.
 */
export class SimilarityClaimClusterer implements IClaimClusterer {
  constructor(
    private readonly similarity: ITextSimilarity,
    private readonly ids: IIdGenerator,
    private readonly threshold = 0.3,
  ) {}

  async cluster(claims: Claim[]): Promise<ClaimCluster[]> {
    const clusters: ClaimCluster[] = [];
    for (const claim of claims) {
      let best: ClaimCluster | undefined;
      let bestSim = 0;
      for (const c of clusters) {
        const sim = Math.max(...c.claims.map((x) => this.similarity.similarity(x.text, claim.text)));
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (best && bestSim >= this.threshold) {
        best.claims.push(claim);
        if (!best.outletIds.includes(claim.outletId)) best.outletIds.push(claim.outletId);
      } else {
        clusters.push({ id: this.ids.next("cluster"), summary: claim.text, claims: [claim], outletIds: [claim.outletId] });
      }
    }
    return clusters;
  }
}

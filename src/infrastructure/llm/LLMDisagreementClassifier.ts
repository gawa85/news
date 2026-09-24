import type { ClaimCluster, Disagreement } from "../../domain/model";
import type { IDisagreementClassifier } from "../../domain/ports";
import type { ILLMClient } from "./ILLMClient";

const SYSTEM = `Recibís grupos de afirmaciones de distintos medios sobre un mismo tema.
Para cada grupo donde las fuentes NO coinciden, clasificá el desacuerdo:
"factual" (datos distintos, verificable), "interpretive" (mismos datos, distinta lectura) o "values" (distintas prioridades).
Devolvé: {"disagreements": [{"type", "clusterId", "description", "positions": [{"outletId", "claimText"}]}]}.
No tomes partido: describí cada postura con la misma neutralidad.`;

export class LLMDisagreementClassifier implements IDisagreementClassifier {
  constructor(private readonly llm: ILLMClient) {}

  async classify(clusters: ClaimCluster[]): Promise<Disagreement[]> {
    const multi = clusters.filter((c) => c.outletIds.length >= 2);
    if (multi.length === 0) return [];
    const payload = multi.map((c) => ({
      clusterId: c.id,
      claims: c.claims.map((x) => ({ outletId: x.outletId, text: x.text, kind: x.kind })),
    }));
    const { data: r } = await this.llm.completeJSON<{ disagreements: Disagreement[] }>({
      system: SYSTEM,
      user: JSON.stringify(payload),
      maxTokens: 4000,
    });
    const valid = new Set(multi.map((c) => c.id));
    return (r.disagreements ?? []).filter((d) => valid.has(d.clusterId));
  }
}

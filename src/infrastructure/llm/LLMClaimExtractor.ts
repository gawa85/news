import { stableClaimId, type Article, type Attribution, type Claim, type ClaimKind } from "../../domain/model";
import type { IClaimExtractor } from "../../domain/ports";
import type { ILLMClient } from "./ILLMClient";

const SYSTEM = `Extraé las afirmaciones concretas de una nota periodística en español.
Para cada una indicá kind: "fact" | "interpretation" | "value", y attribution: "named" | "official_document" | "anonymous" | "none".
Devolvé: {"claims": [{"text", "kind", "attribution", "numbers": [number]}]}. Una afirmación por ítem, reescrita en forma breve y neutra.`;

interface RawClaim {
  text: string;
  kind: ClaimKind;
  attribution: Attribution;
  numbers?: number[];
}

export class LLMClaimExtractor implements IClaimExtractor {
  constructor(private readonly llm: ILLMClient) {}

  async extract(article: Article): Promise<Claim[]> {
    const { data: r } = await this.llm.completeJSON<{ claims: RawClaim[] }>({
      system: SYSTEM,
      user: `Título: ${article.title}\n\n${article.body}`,
    });
    return (r.claims ?? []).map((c) => ({
      id: stableClaimId(article.id, c.text),
      articleId: article.id,
      outletId: article.outletId,
      text: c.text,
      kind: c.kind,
      attribution: c.attribution,
      numbers: c.numbers ?? [],
    }));
  }
}

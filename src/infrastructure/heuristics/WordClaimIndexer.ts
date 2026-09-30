import type { Claim } from "../../domain/model";
import type { IClaimIndex, IClaimIndexer, RelatedClaim } from "../../domain/ports";
import { contentWords } from "./text";

/**
 * Índice por palabras con contenido. Dos afirmaciones hablan de lo mismo si comparten varias
 * palabras poco comunes (no "gobierno" ni "país", que están en todas). Así se encuentran aunque
 * estén redactadas distinto, y sin comparar cada una contra todas: con miles de afirmaciones,
 * comparar todas contra todas tardaba minutos.
 */
export class WordClaimIndexer implements IClaimIndexer {
  constructor(
    private readonly opts = {
      /** Palabras en común para empezar a considerarlas parecidas. */
      minShared: 3,
      /** Qué parte del texto más corto tiene que estar en el otro. */
      minOverlap: 0.5,
      /** Desde acá, es el mismo texto copiado. */
      copy: 0.85,
      /** Una palabra que aparece en más de esta fracción de las afirmaciones no sirve para relacionar. */
      commonWord: 0.05,
    },
  ) {}

  index(claims: Claim[]): IClaimIndex {
    const words = new Map<string, Set<string>>();
    const byWord = new Map<string, Claim[]>();
    for (const c of claims) {
      const w = contentWords(c.text);
      words.set(c.id, w);
      for (const x of w) (byWord.get(x) ?? byWord.set(x, []).get(x)!).push(c);
    }
    const tooCommon = Math.max(20, claims.length * this.opts.commonWord);
    const { minShared, minOverlap, copy } = this.opts;

    return {
      related: (claim: Claim): RelatedClaim[] => {
        const mine = words.get(claim.id) ?? contentWords(claim.text);
        if (mine.size === 0) return [];
        const shared = new Map<Claim, number>();
        for (const x of mine) {
          const list = byWord.get(x);
          if (!list || list.length > tooCommon) continue;
          for (const o of list) if (o.id !== claim.id) shared.set(o, (shared.get(o) ?? 0) + 1);
        }
        const out: RelatedClaim[] = [];
        for (const [o, n] of shared) {
          if (n < minShared) continue;
          const theirs = words.get(o.id)!;
          // (el conteo de arriba saltea las palabras comunes: acá se cuentan todas)
          let inter = 0;
          for (const x of mine) if (theirs.has(x)) inter++;
          const overlap = inter / Math.min(mine.size, theirs.size);
          if (overlap < minOverlap) continue;
          out.push({ claim: o, overlap, copy: inter / (mine.size + theirs.size - inter) >= copy });
        }
        return out.sort((a, b) => b.overlap - a.overlap);
      },
    };
  }
}

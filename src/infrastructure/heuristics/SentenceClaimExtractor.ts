import { stableClaimId, type Article, type Attribution, type Claim, type ClaimKind } from "../../domain/model";
import type { IClaimExtractor } from "../../domain/ports";
import { extractNumbers, findPhrases, splitSentences } from "./text";

const INTERPRETATION = ["lo que demuestra", "significa que", "confirma", "es un éxito", "es un fracaso", "es un golpe", "es un alivio", "representa un"];
const VALUE = ["debería", "deberían", "es injusto", "lo prioritario", "es necesario", "no se puede permitir"];
const OFFICIAL_DOC = ["resolución", "boletín oficial", "decreto", "informe del", "según datos del", "indec"];
const NAMED_SOURCE =
  /\b(seg[uú]n|afirm\w*|declar\w*|explic\w*|dijo|sostuvo|indic\w*)\b[^.]*?\b[A-ZÁÉÍÓÚ][a-záéíóúñ]+ [A-ZÁÉÍÓÚ][a-záéíóúñ]+/;
const ANONYMOUS = ["según fuentes", "fuentes cercanas", "trascendió", "se supo que"];

/** Extrae afirmaciones oración por oración con reglas simples. */
export class SentenceClaimExtractor implements IClaimExtractor {
  async extract(article: Article): Promise<Claim[]> {
    const claims: Claim[] = [];
    for (const text of splitSentences(article.body)) {
      const kind = this.kindOf(text);
      if (!kind) continue;
      claims.push({
        id: stableClaimId(article.id, text),
        articleId: article.id,
        outletId: article.outletId,
        text,
        kind,
        attribution: this.attributionOf(text),
        numbers: extractNumbers(text),
      });
    }
    return claims;
  }

  private kindOf(text: string): ClaimKind | null {
    if (findPhrases(text, VALUE).length) return "value";
    if (findPhrases(text, INTERPRETATION).length) return "interpretation";
    if (extractNumbers(text).length) return "fact";
    return null;
  }

  private attributionOf(text: string): Attribution {
    if (findPhrases(text, ANONYMOUS).length) return "anonymous";
    if (findPhrases(text, OFFICIAL_DOC).length) return "official_document";
    // "según Juan Pérez", "según explicó el secretario Juan Pérez", "afirmó la ministra María López"
    if (NAMED_SOURCE.test(text)) return "named";
    return "none";
  }
}

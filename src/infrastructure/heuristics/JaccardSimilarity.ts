import type { ITextSimilarity } from "../../domain/ports";
import { contentWords } from "./text";

/** Parecido por palabras en común (índice de Jaccard). Se puede reemplazar por embeddings. */
export class JaccardSimilarity implements ITextSimilarity {
  similarity(a: string, b: string): number {
    const A = contentWords(a);
    const B = contentWords(b);
    if (A.size === 0 && B.size === 0) return 1;
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    return inter / (A.size + B.size - inter);
  }
}

/**
 * Parecido por "cuánto del texto más corto está en el otro" (coeficiente de solapamiento).
 * Mejor que Jaccard para variantes de una cadena de distinto largo.
 */
export class OverlapSimilarity implements ITextSimilarity {
  similarity(a: string, b: string): number {
    const A = contentWords(a);
    const B = contentWords(b);
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    return inter / Math.min(A.size, B.size);
  }
}

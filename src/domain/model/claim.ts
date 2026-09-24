/**
 * Una afirmación concreta extraída de un artículo.
 * La comparación entre fuentes se hace a nivel de afirmación, no de artículo.
 */
export type ClaimKind =
  | "fact" // verificable: "la tarifa sube 30%"
  | "interpretation" // lectura de los hechos: "es un éxito de la gestión"
  | "value"; // prioridad o juicio moral: "lo prioritario es proteger a los jubilados"

export type Attribution =
  | "named" // fuente con nombre y apellido o institución
  | "official_document" // resolución, Boletín Oficial, informe estadístico
  | "anonymous" // "fuentes cercanas", "trascendió"
  | "none"; // sin atribución

export interface Claim {
  id: string;
  articleId: string;
  outletId: string;
  text: string;
  kind: ClaimKind;
  attribution: Attribution;
  numbers: number[];
}

/**
 * Id ESTABLE de una afirmación: depende de la nota y del texto, no de cuándo se procesó.
 * Así, reprocesar una nota no rompe las verificaciones ni las tareas que la citan.
 */
export function stableClaimId(articleId: string, text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = `${articleId}|${text.trim().toLowerCase().replace(/\s+/g, " ")}`;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `claim_${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export type VerdictStatus = "confirmed" | "refuted" | "disputed";

/** Resultado de verificar una afirmación contra fuentes primarias, con posterioridad. */
export interface ClaimVerdict {
  claimId: string;
  status: VerdictStatus;
  checkedAt: Date;
  evidenceUrl?: string;
}

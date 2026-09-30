import type { DimensionScore } from "../model";

/**
 * ¿Hay con qué respaldar un puntaje general?
 *  - "verified": personas verificaron afirmaciones del medio (exactitud).
 *  - "corroborated": sus datos se cotejaron con los de otros medios (no es una verificación:
 *    que varios digan lo mismo no lo hace cierto, pero es más que nada).
 *  - "unverified": ninguna de las dos. Que una nota tenga cifras y cite fuentes no quiere decir
 *    que sean ciertas: sin corroborar, NO se da un puntaje general.
 */
export type VerificationStatus = "verified" | "corroborated" | "unverified";

export interface VerificationState {
  status: VerificationStatus;
  /** Explicación para la persona. */
  note: string;
}

/** Cotejos mínimos (datos con cifra que también publicó otro medio) para dar un puntaje. */
export const MIN_CORROBORATION_CONFIDENCE = 0.5;

export function verificationState(dimensions: DimensionScore[]): VerificationState {
  const accuracy = dimensions.find((d) => d.dimensionId === "accuracy");
  const corroboration = dimensions.find((d) => d.dimensionId === "corroboration");
  if (accuracy && accuracy.score !== null) {
    return { status: "verified", note: `Hay afirmaciones verificadas por personas: ${accuracy.summary}` };
  }
  if (corroboration && corroboration.score !== null && corroboration.confidence >= MIN_CORROBORATION_CONFIDENCE) {
    return {
      status: "corroborated",
      note: "Sus datos se cotejaron con lo que publicaron otros medios, pero nadie los verificó todavía contra la fuente original. Que varios medios digan lo mismo no lo hace cierto.",
    };
  }
  return {
    status: "unverified",
    note: "Todavía no se corroboró ningún dato de este medio sobre el tema, así que no damos un puntaje general. Lo de abajo mide cómo están escritas las notas (si citan fuentes, cuánto humo tienen), no si lo que dicen es cierto.",
  };
}

/**
 * Puertos del MEDIDOR DE CREDIBILIDAD.
 *
 * Cada dimensión (exactitud, fuentes, conflicto de interés, pauta, coherencia...)
 * es una clase que implementa ICredibilityDimension. Agregar una dimensión nueva
 * = escribir una clase nueva y registrarla. No se toca el motor (OCP).
 */
import type {
  Article,
  Claim,
  CredibilityQuery,
  CredibilityReport,
  DimensionScore,
  Outlet,
} from "../model";

/** Datos que el motor carga UNA vez y comparte con todas las dimensiones. */
export interface EvaluationContext {
  query: CredibilityQuery;
  outlet: Outlet;
  articles: Article[];
  claims: Claim[];
}

export interface ICredibilityDimension {
  readonly id: string;
  readonly label: string;
  evaluate(ctx: EvaluationContext): Promise<DimensionScore>;
}

/** Cómo (y si) se combinan las dimensiones en un número resumen. */
export interface IAggregationPolicy {
  aggregate(scores: DimensionScore[]): number | null;
}

/** Abstracción del evaluador, para que otros casos de uso (p. ej. la línea de tiempo) dependan de ella. */
export interface ICredibilityEvaluator {
  evaluate(query: CredibilityQuery): Promise<CredibilityReport>;
}

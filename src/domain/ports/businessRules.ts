import type { AccessContext, RuleDecision } from "../model";

/**
 * Una regla de negocio = una clase. El motor ejecuta una lista de reglas en orden
 * y corta en la primera que deniega. Agregar una regla no toca el motor (OCP).
 */
export interface IBusinessRule {
  readonly id: string;
  check(ctx: AccessContext): RuleDecision;
}

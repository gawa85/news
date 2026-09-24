import { urlMatches, type UrlRules, type User } from "../../domain/model";
import type { IRuleSetRepository } from "../../domain/ports";
import { billingSubjectOf } from "../access/AccessControl";

/**
 * Combina las reglas de URL de un pedido con las guardadas por el usuario y su organización.
 *
 * REGLAS DE NEGOCIO:
 *  - Las exclusiones de la ORGANIZACIÓN son obligatorias: ni siquiera un `include`
 *    explícito del miembro las saltea (p. ej. la empresa bloquea un sitio).
 *  - Las exclusiones PERSONALES se suman, pero un `include` explícito del pedido gana.
 *  - `onlyFrom`: manda el pedido; si no trae, el del usuario; si no, el de la organización.
 */
export class UserRulesResolver {
  constructor(private readonly ruleSets: IRuleSetRepository) {}

  async resolve(user: User, request: UrlRules = {}): Promise<{ rules: UrlRules; blockedIncludes: string[] }> {
    const personal = { type: "user" as const, id: user.id };
    const org = user.organizationId ? billingSubjectOf(user) : undefined;
    const sets = await this.ruleSets.findActiveFor(org ? [personal, org] : [personal]);

    const orgSets = sets.filter((s) => s.owner.type === "organization");
    const userSets = sets.filter((s) => s.owner.type === "user");
    const orgExclude = orgSets.flatMap((s) => s.urlRules.exclude ?? []);
    const userExclude = userSets.flatMap((s) => s.urlRules.exclude ?? []);

    const include = request.include ?? [];
    const blockedIncludes = include.filter((u) => orgExclude.some((p) => urlMatches(u, p)));

    const pickOnly = (xs: UrlRules[]) => xs.map((r) => r.onlyFrom ?? []).find((o) => o.length > 0);
    return {
      rules: {
        include: include.filter((u) => !blockedIncludes.includes(u)),
        exclude: unique([...orgExclude, ...userExclude, ...(request.exclude ?? [])]),
        onlyFrom: request.onlyFrom?.length ? request.onlyFrom : pickOnly(userSets.map((s) => s.urlRules)) ?? pickOnly(orgSets.map((s) => s.urlRules)),
      },
      blockedIncludes,
    };
  }
}

const unique = <T>(xs: T[]) => [...new Set(xs)];

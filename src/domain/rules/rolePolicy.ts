/**
 * REGLAS DE NEGOCIO sobre usuarios y roles (quién puede asignar qué a quién).
 */
import type { Permission, Role, User } from "../model";

export type PolicyResult = { ok: true } | { ok: false; reason: string };

/**
 * - Un administrador de plataforma (users:manage_all) puede asignar cualquier rol.
 * - Un administrador de organización (users:manage_org) sólo puede asignar roles
 *   de alcance "organization", sólo a miembros de SU organización, y nunca
 *   permisos que él mismo no tiene (no se puede escalar privilegios).
 * - Nadie se quita a sí mismo el último rol de administración (evita organizaciones sin admin).
 */
export function canAssignRole(
  actor: User,
  actorPerms: ReadonlySet<Permission>,
  target: User,
  role: Role,
): PolicyResult {
  if (actorPerms.has("users:manage_all")) return { ok: true };
  if (!actorPerms.has("users:manage_org")) return { ok: false, reason: "No tenés permiso para administrar usuarios." };
  if (!actor.organizationId || actor.organizationId !== target.organizationId) {
    return { ok: false, reason: "Sólo podés administrar usuarios de tu organización." };
  }
  if (role.scope !== "organization") return { ok: false, reason: `El rol "${role.name}" sólo lo asigna un administrador de la plataforma.` };
  const escalation = role.permissions.filter((p) => !actorPerms.has(p));
  if (escalation.length) return { ok: false, reason: `No podés otorgar permisos que no tenés: ${escalation.join(", ")}.` };
  return { ok: true };
}

export function canRemoveRole(actor: User, target: User, role: Role, adminsLeft: number): PolicyResult {
  const isAdminRole = role.permissions.includes("users:manage_org");
  if (isAdminRole && actor.id === target.id && adminsLeft <= 1) {
    return { ok: false, reason: "Sos el último administrador de la organización: asigná otro antes de quitarte el rol." };
  }
  return { ok: true };
}

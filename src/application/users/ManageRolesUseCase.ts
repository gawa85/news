import { AccessDeniedError, NotFoundError } from "../../domain/errors";
import type { User } from "../../domain/model";
import { canAssignRole, canRemoveRole } from "../../domain/rules/rolePolicy";
import type { IAuthorizationService, IDomainEvents, IRoleRepository, IUserRepository } from "../../domain/ports";

/** Asignar o quitar roles, respetando la política de quién puede darle qué a quién. */
export class ManageRolesUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly roles: IRoleRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
  ) {}

  async assign(input: { actorId: string; targetId: string; roleId: string }): Promise<User> {
    const { actor, target, role, perms } = await this.load(input);
    const check = canAssignRole(actor, perms, target, role);
    if (!check.ok) throw new AccessDeniedError(check.reason, "no_permission");
    if (!target.roleIds.includes(role.id)) target.roleIds.push(role.id);
    await this.users.save(target);
    await this.events.emit("role.assigned", { userId: actor.id, organizationId: actor.organizationId }, { roleId: role.id }, { type: "user", id: target.id });
    return target;
  }

  async remove(input: { actorId: string; targetId: string; roleId: string }): Promise<User> {
    const { actor, target, role, perms } = await this.load(input);
    const assignCheck = canAssignRole(actor, perms, target, role); // mismas reglas para quitar
    if (!assignCheck.ok) throw new AccessDeniedError(assignCheck.reason, "no_permission");

    const members = target.organizationId ? await this.users.findByOrganization(target.organizationId) : [target];
    const allRoles = await this.roles.findAll();
    const adminRoleIds = new Set(allRoles.filter((r) => r.permissions.includes("users:manage_org")).map((r) => r.id));
    const adminsLeft = members.filter((m) => m.roleIds.some((id) => adminRoleIds.has(id))).length;
    const removeCheck = canRemoveRole(actor, target, role, adminsLeft);
    if (!removeCheck.ok) throw new AccessDeniedError(removeCheck.reason, "no_permission");

    target.roleIds = target.roleIds.filter((id) => id !== role.id);
    await this.users.save(target);
    await this.events.emit("role.removed", { userId: actor.id, organizationId: actor.organizationId }, { roleId: role.id }, { type: "user", id: target.id });
    return target;
  }

  private async load(input: { actorId: string; targetId: string; roleId: string }) {
    const [actor, target, [role]] = await Promise.all([
      this.users.findById(input.actorId),
      this.users.findById(input.targetId),
      this.roles.findByIds([input.roleId]),
    ]);
    if (!actor || !target) throw new NotFoundError("Usuario inexistente.");
    if (!role) throw new NotFoundError(`No existe el rol ${input.roleId}.`);
    return { actor, target, role, perms: await this.authz.permissionsOf(actor) };
  }
}

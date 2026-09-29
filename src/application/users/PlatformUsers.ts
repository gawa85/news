import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { ChannelType, Role, User, UserStatus } from "../../domain/model";
import type { IAuthorizationService, IClock, IDomainEvents, IOrganizationRepository, IRoleRepository, IUserDirectory, IUserRepository } from "../../domain/ports";
import { canRemovePlatformAccess } from "../../domain/rules/rolePolicy";
import type { ManageRolesUseCase } from "./ManageRolesUseCase";

export interface AdminUser {
  id: string;
  name: string;
  status: UserStatus;
  roleIds: string[];
  organization?: { id: string; name: string };
  channels: { channel: ChannelType; address: string; verified: boolean }[];
  representsOutletIds: string[];
  suspension?: User["suspension"];
  createdAt: Date;
}

export type UserListFilter = "staff" | "suspended";

const PHONE = /^\+?[\d\s-]{6,20}$/;
const MAX = 100;

/**
 * PERSONAS Y ROLES DE LA PLATAFORMA (permiso `users:manage_all`): buscar una cuenta, darle o
 * quitarle roles del equipo, acreditarla como representante de un medio y suspenderla.
 * REGLAS:
 *  - Se busca por dato exacto (mail, teléfono, id): no hay búsqueda por nombre (no se
 *    recorren todas las cuentas y se evita "pescar" datos personales).
 *  - Siempre queda al menos una cuenta activa que administra la plataforma; nadie se suspende a sí mismo.
 *  - Suspender cierra todas las sesiones al instante; las claves de API y los chats dejan de funcionar.
 *  - Todo queda en la auditoría, con el motivo.
 */
export class PlatformUsersService {
  constructor(
    private readonly users: IUserRepository & IUserDirectory,
    private readonly roles: IRoleRepository,
    private readonly organizations: IOrganizationRepository,
    private readonly authz: IAuthorizationService,
    private readonly events: IDomainEvents,
    private readonly manageRoles: ManageRolesUseCase,
    private readonly revokeSessions: (userId: string) => Promise<number>,
    private readonly clock: IClock,
  ) {}

  async roleCatalog(actorId: string): Promise<Pick<Role, "id" | "name" | "description" | "scope">[]> {
    await this.admin(actorId);
    return (await this.roles.findAll()).map(({ id, name, description, scope }) => ({ id, name, description, scope }));
  }

  /** Por mail, teléfono o id exactos; sin texto, el equipo de la plataforma o las suspendidas. */
  async search(actorId: string, input: { q?: string; filter?: UserListFilter }): Promise<AdminUser[]> {
    await this.admin(actorId);
    const q = (input.q ?? "").trim();
    if (q) return this.view((await this.lookup(q)).filter((u) => u.status !== "deleted"));
    if (input.filter === "suspended") return this.view(await this.users.findByStatus("suspended", MAX));
    const staff = (await this.roles.findAll()).filter((r) => r.scope === "platform").map((r) => r.id);
    return this.view((await this.users.findWithRoles(staff, MAX)).filter((u) => u.status !== "deleted"));
  }

  async detail(actorId: string, userId: string): Promise<AdminUser> {
    await this.admin(actorId);
    return this.present(userId);
  }

  /** Cómo quedó la cuenta después de un cambio (quien lo hizo pudo haber perdido el permiso: se quitó su rol). */
  private async present(userId: string): Promise<AdminUser> {
    return (await this.view([await this.target(userId)]))[0]!;
  }

  async addRole(actorId: string, userId: string, roleId: string): Promise<AdminUser> {
    const actor = await this.admin(actorId);
    await this.target(userId);
    await this.manageRoles.assign({ actorId: actor.id, targetId: userId, roleId });
    return this.present(userId);
  }

  async removeRole(actorId: string, userId: string, roleId: string): Promise<AdminUser> {
    const actor = await this.admin(actorId);
    const target = await this.target(userId);
    const adminRoles = await this.platformAdminRoles();
    // Sólo importa si al quitar ESTE rol deja de administrar la plataforma.
    const losesAdmin = adminRoles.has(roleId) && !target.roleIds.some((r) => r !== roleId && adminRoles.has(r));
    const check = canRemovePlatformAccess(actor, target, "remove_role", losesAdmin, await this.otherAdmins(target.id, adminRoles));
    if (!check.ok) throw new ConflictError(check.reason);
    await this.manageRoles.remove({ actorId: actor.id, targetId: userId, roleId });
    return this.present(userId);
  }

  async suspend(actorId: string, userId: string, reason: string): Promise<AdminUser> {
    const actor = await this.admin(actorId);
    const target = await this.target(userId);
    const why = cleanReason(reason);
    if (target.status !== "active") throw new ConflictError("La cuenta no está activa.");
    const adminRoles = await this.platformAdminRoles();
    const check = canRemovePlatformAccess(actor, target, "suspend", target.roleIds.some((r) => adminRoles.has(r)), await this.otherAdmins(target.id, adminRoles));
    if (!check.ok) throw new ConflictError(check.reason);
    await this.users.save({ ...target, status: "suspended", suspension: { reason: why, at: this.clock.now(), by: actor.id } });
    const sessions = await this.revokeSessions(target.id);
    await this.events.emit("user.suspended", { userId: actor.id }, { reason: why, sessions }, { type: "user", id: target.id });
    return this.present(userId);
  }

  async reactivate(actorId: string, userId: string, reason: string): Promise<AdminUser> {
    const actor = await this.admin(actorId);
    const target = await this.target(userId);
    const why = cleanReason(reason);
    if (target.status !== "suspended") throw new ConflictError("La cuenta no está suspendida.");
    await this.users.save({ ...target, status: "active", suspension: undefined });
    await this.events.emit("user.reactivated", { userId: actor.id }, { reason: why }, { type: "user", id: target.id });
    return this.present(userId);
  }

  private async lookup(q: string): Promise<User[]> {
    const found: (User | undefined)[] = [];
    if (q.includes("@")) found.push(await this.users.findByChannel("email", q.toLowerCase()));
    else if (PHONE.test(q)) {
      const digits = q.replace(/[\s-]/g, "");
      const variants = [...new Set([digits, digits.startsWith("+") ? digits.slice(1) : `+${digits}`])];
      for (const ch of ["whatsapp", "sms", "telegram"] as ChannelType[]) for (const v of variants) found.push(await this.users.findByChannel(ch, v));
    }
    found.push(await this.users.findById(q));
    return [...new Map(found.filter((u): u is User => !!u).map((u) => [u.id, u])).values()];
  }

  private async view(users: User[]): Promise<AdminUser[]> {
    const orgNames = new Map<string, string>();
    for (const id of new Set(users.map((u) => u.organizationId).filter((x): x is string => !!x))) {
      const o = await this.organizations.findById(id);
      if (o) orgNames.set(id, o.name);
    }
    return users.map((u) => ({
      id: u.id, name: u.name, status: u.status, roleIds: u.roleIds,
      organization: u.organizationId ? { id: u.organizationId, name: orgNames.get(u.organizationId) ?? u.organizationId } : undefined,
      channels: u.channels.map(({ channel, address, verified }) => ({ channel, address, verified })),
      representsOutletIds: u.representsOutletIds ?? [], suspension: u.suspension, createdAt: u.createdAt,
    }));
  }

  private async platformAdminRoles(): Promise<Set<string>> {
    return new Set((await this.roles.findAll()).filter((r) => r.permissions.includes("users:manage_all")).map((r) => r.id));
  }

  private async otherAdmins(exceptId: string, adminRoles: Set<string>): Promise<number> {
    return (await this.users.findWithRoles([...adminRoles], MAX)).filter((u) => u.id !== exceptId && u.status === "active").length;
  }

  private async target(userId: string): Promise<User> {
    const u = await this.users.findById(userId);
    if (!u || u.status === "deleted") throw new NotFoundError("No existe esa cuenta.");
    return u;
  }

  private async admin(actorId: string): Promise<User> {
    const u = await this.users.findById(actorId);
    if (!u || !(await this.authz.permissionsOf(u)).has("users:manage_all")) throw new AccessDeniedError("Sólo la administración de la plataforma gestiona cuentas.", "no_permission");
    return u;
  }
}

function cleanReason(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  if (r.length < 10) throw new ValidationError("Explicá el motivo (al menos 10 caracteres): queda en la auditoría.");
  return r;
}

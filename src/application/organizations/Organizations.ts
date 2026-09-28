import { createHash, randomBytes } from "node:crypto";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { Organization, OrganizationInvitation, Role, User } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IDomainEvents,
  IIdGenerator,
  IOrganizationInvitationRepository,
  IOrganizationRepository,
  IPlanRepository,
  IRoleRepository,
  ISubscriptionRepository,
  IUserRepository,
} from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";
import type { NotificationService } from "../messaging/NotificationService";
import type { CreateOrganizationUseCase } from "../users/PlansUseCases";
import type { ManageRolesUseCase } from "../users/ManageRolesUseCase";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface OrganizationOverview {
  organization: Pick<Organization, "id" | "name" | "createdAt">;
  plan: { id: string; name: string };
  /** Personas y lugares: los invitados pendientes también ocupan lugar. */
  seats: { used: number; limit: number | null };
  canManage: boolean;
  members: { id: string; name: string; roleIds: string[]; email?: string; isMe: boolean }[];
  /** Roles que se pueden dar dentro de la organización. */
  roles: Pick<Role, "id" | "name" | "description">[];
  invitations: Pick<OrganizationInvitation, "id" | "email" | "roleId" | "createdAt" | "expiresAt">[];
}

/**
 * ORGANIZACIONES: crear, ver el equipo, invitar por mail, cambiar roles, sacar a alguien o irse.
 * REGLAS:
 *  - Administra quien tiene `users:manage_org` (en su organización).
 *  - Invitar: rol de organización sin permisos que el que invita no tenga; hay lugar en el plan
 *    (los pendientes cuentan). El enlace es de un solo uso y vence; se guarda sólo su huella.
 *  - Aceptar: sólo quien tiene verificado el MAIL invitado (un enlace reenviado no sirve a otro).
 *    Si tiene un plan personal pago vigente, primero lo cancela (no se cobra dos veces).
 *  - La organización nunca queda sin administrador mientras tenga miembros.
 *  - Al salir, la persona conserva su cuenta y su historial, con el plan Gratis.
 */
export class OrganizationService {
  constructor(
    private readonly users: IUserRepository,
    private readonly organizations: IOrganizationRepository,
    private readonly invitations: IOrganizationInvitationRepository,
    private readonly roleRepo: IRoleRepository,
    private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: IPlanRepository,
    private readonly createOrganization: CreateOrganizationUseCase,
    private readonly manageRoles: ManageRolesUseCase,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly notifications: NotificationService,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly opts: { publicBaseUrl: string; invitationDays: number; memberRoleId: string; freePlanId: string },
  ) {}

  async create(input: { actorId: string; name: string }): Promise<OrganizationOverview> {
    const name = input.name.trim();
    if (name.length < 3 || name.length > 80) throw new ValidationError("El nombre tiene que tener entre 3 y 80 caracteres.");
    const actor = await this.access.userOrThrow(input.actorId);
    await this.requireNoPaidPersonalPlan(actor);
    await this.createOrganization.execute({ ownerId: actor.id, name });
    return this.overview(actor.id);
  }

  async overview(actorId: string): Promise<OrganizationOverview> {
    const actor = await this.access.userOrThrow(actorId);
    if (!actor.organizationId) throw new NotFoundError("No sos parte de una organización.");
    const org = await this.organizations.findById(actor.organizationId);
    if (!org) throw new NotFoundError("No existe la organización.");
    const canManage = (await this.authz.permissionsOf(actor)).has("users:manage_org");
    const members = await this.activeMembers(org.id);
    const pending = await this.pendingInvitations(org.id);
    const { plan } = await this.access.planOf(actor);
    const assignable = canManage ? await this.assignableRoles(actor) : [];
    return {
      organization: { id: org.id, name: org.name, createdAt: org.createdAt },
      plan: { id: plan.id, name: plan.name },
      seats: { used: members.length + pending.length, limit: plan.limits.seats },
      canManage,
      members: members.map((m) => ({
        id: m.id, name: m.name, roleIds: m.roleIds, isMe: m.id === actor.id,
        // El contacto de los demás lo ve sólo quien administra.
        ...(canManage ? { email: m.channels.find((c) => c.channel === "email" && c.verified)?.address } : {}),
      })),
      roles: assignable.map(({ id, name, description }) => ({ id, name, description })),
      invitations: canManage ? pending.map(({ id, email, roleId, createdAt, expiresAt }) => ({ id, email, roleId, createdAt, expiresAt })) : [],
    };
  }

  async invite(input: { actorId: string; email: string; roleId?: string }): Promise<OrganizationOverview["invitations"][number]> {
    const { actor, org } = await this.manager(input.actorId);
    const email = input.email.trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 200) throw new ValidationError("El mail no es válido.");
    const roleId = input.roleId ?? this.opts.memberRoleId;
    if (!(await this.assignableRoles(actor)).some((r) => r.id === roleId)) throw new AccessDeniedError("No podés dar ese rol.", "no_permission");

    const members = await this.activeMembers(org.id);
    if (members.some((m) => m.channels.some((c) => c.channel === "email" && c.address.toLowerCase() === email))) {
      throw new ConflictError("Esa persona ya es parte de la organización.");
    }
    // Reinvitar al mismo mail reemplaza la invitación anterior (y no ocupa otro lugar).
    const pending = await this.pendingInvitations(org.id);
    const previous = pending.find((i) => i.email === email);
    const { plan } = await this.access.planOf(actor);
    const used = members.length + pending.length - (previous ? 1 : 0);
    if (plan.limits.seats !== null && used + 1 > plan.limits.seats) {
      throw new AccessDeniedError(`El plan ${plan.name} permite ${plan.limits.seats} personas y ya están todos los lugares ocupados (contando invitaciones pendientes).`, "limit_exceeded");
    }
    if (previous) await this.invitations.save({ ...previous, status: "revoked" });

    const token = randomBytes(24).toString("base64url");
    const now = this.clock.now();
    const invitation: OrganizationInvitation = {
      id: this.ids.next("invite"), organizationId: org.id, email, roleId, tokenHash: sha(token), invitedBy: actor.id,
      createdAt: now, expiresAt: new Date(now.getTime() + this.opts.invitationDays * 86_400_000), status: "pending",
    };
    await this.invitations.save(invitation);
    await this.notifications.sendTo("email", email, {
      kind: "info",
      title: `Te invitaron a ${org.name} en Sin Humo`,
      sections: [{ lines: [
        `${actor.name} te invitó a sumarte al equipo de ${org.name} en Sin Humo.`,
        `Entrá con este mail (${email}) y aceptá la invitación. El enlace vence en ${this.opts.invitationDays} días y sirve una sola vez.`,
        "Si no esperabas este mail, ignoralo.",
      ] }],
      links: [{ label: "Sumarme al equipo", url: `${this.opts.publicBaseUrl}/unirme?token=${token}` }],
    }, "verification");
    await this.events.emit("organization.invitation_sent", { userId: actor.id, organizationId: org.id }, { roleId }, { type: "invitation", id: invitation.id });
    const { id, createdAt, expiresAt } = invitation;
    return { id, email, roleId, createdAt, expiresAt };
  }

  async revokeInvitation(input: { actorId: string; invitationId: string }): Promise<void> {
    const { org } = await this.manager(input.actorId);
    const inv = await this.invitations.findById(input.invitationId);
    if (!inv || inv.organizationId !== org.id || inv.status !== "pending") throw new NotFoundError("No existe esa invitación.");
    await this.invitations.save({ ...inv, status: "revoked" });
  }

  /** Lo que ve quien abre el enlace antes de aceptar (sin datos de otros miembros). */
  async preview(token: string): Promise<{ organization: string; invitedBy: string; email: string; expiresAt: Date }> {
    const inv = await this.validInvitation(token);
    const [org, by] = await Promise.all([this.organizations.findById(inv.organizationId), this.users.findById(inv.invitedBy)]);
    return { organization: org?.name ?? "", invitedBy: by?.name ?? "", email: inv.email, expiresAt: inv.expiresAt };
  }

  async accept(input: { actorId: string; token: string }): Promise<OrganizationOverview> {
    const inv = await this.validInvitation(input.token);
    const user = await this.access.userOrThrow(input.actorId);
    if (!user.channels.some((c) => c.channel === "email" && c.verified && c.address.toLowerCase() === inv.email)) {
      throw new AccessDeniedError(`Esta invitación es para ${inv.email}. Entrá con ese mail para aceptarla.`, "no_permission");
    }
    if (user.organizationId === inv.organizationId) throw new ConflictError("Ya sos parte de esta organización.");
    if (user.organizationId) throw new ConflictError("Ya sos parte de otra organización: salí de ella antes de sumarte a esta.");
    await this.requireNoPaidPersonalPlan(user);

    const roles = await this.roleRepo.findAll();
    const platformRoles = user.roleIds.filter((id) => roles.find((r) => r.id === id)?.scope === "platform");
    await this.users.save({ ...user, organizationId: inv.organizationId, roleIds: [...new Set([...platformRoles, inv.roleId])] });
    await this.invitations.save({ ...inv, status: "accepted", acceptedBy: user.id, acceptedAt: this.clock.now() });
    await this.events.emit("organization.member_joined", { userId: user.id, organizationId: inv.organizationId }, { roleId: inv.roleId }, { type: "user", id: user.id });
    return this.overview(user.id);
  }

  /** Deja un solo rol de organización (los de plataforma no se tocan). Usa las reglas de siempre. */
  async setRole(input: { actorId: string; memberId: string; roleId: string }): Promise<OrganizationOverview> {
    const { org } = await this.manager(input.actorId);
    const member = await this.users.findById(input.memberId);
    if (!member || member.organizationId !== org.id) throw new NotFoundError("Esa persona no es parte de la organización.");
    await this.manageRoles.assign({ actorId: input.actorId, targetId: member.id, roleId: input.roleId });
    const roles = await this.roleRepo.findAll();
    for (const r of member.roleIds) {
      if (r !== input.roleId && roles.find((x) => x.id === r)?.scope === "organization") {
        await this.manageRoles.remove({ actorId: input.actorId, targetId: member.id, roleId: r });
      }
    }
    return this.overview(input.actorId);
  }

  async removeMember(input: { actorId: string; memberId: string }): Promise<OrganizationOverview> {
    if (input.memberId === input.actorId) throw new ValidationError("Para irte de la organización, usá «Salir».");
    const { org } = await this.manager(input.actorId);
    const member = await this.users.findById(input.memberId);
    if (!member || member.organizationId !== org.id) throw new NotFoundError("Esa persona no es parte de la organización.");
    await this.detach(member, input.actorId);
    return this.overview(input.actorId);
  }

  async leave(actorId: string): Promise<void> {
    const actor = await this.access.userOrThrow(actorId);
    if (!actor.organizationId) throw new NotFoundError("No sos parte de una organización.");
    const members = await this.activeMembers(actor.organizationId);
    if (members.length > 1 && (await this.isAdmin(actor)) && (await this.admins(members)).length <= 1) {
      throw new ValidationError("Sos la única persona que administra: dale el rol de administrador a otra antes de irte.");
    }
    await this.detach(actor, actorId);
  }

  // ---------------- internos ----------------

  private async detach(member: User, actorId: string): Promise<void> {
    const orgId = member.organizationId!;
    const roles = await this.roleRepo.findAll();
    const platformRoles = member.roleIds.filter((id) => roles.find((r) => r.id === id)?.scope === "platform");
    await this.users.save({ ...member, organizationId: undefined, roleIds: [...new Set([...platformRoles, this.opts.memberRoleId])] });
    // Vuelve a su cuenta personal: si no tiene suscripción vigente, plan Gratis.
    const subject = { type: "user" as const, id: member.id };
    const current = await this.subscriptions.findCurrent(subject);
    if (!current) {
      const now = this.clock.now();
      await this.subscriptions.save({ id: this.ids.next("sub"), subject, planId: this.opts.freePlanId, status: "active", currentPeriodEnd: new Date(now.getTime() + 3650 * 86_400_000), createdAt: now });
    }
    await this.events.emit("organization.member_removed", { userId: actorId, organizationId: orgId }, { self: actorId === member.id }, { type: "user", id: member.id });
  }

  private async manager(actorId: string): Promise<{ actor: User; org: Organization }> {
    const actor = await this.access.userOrThrow(actorId);
    if (!actor.organizationId) throw new NotFoundError("No sos parte de una organización.");
    if (!(await this.authz.permissionsOf(actor)).has("users:manage_org")) throw new AccessDeniedError("Sólo quien administra la organización puede hacer esto.", "no_permission");
    const org = await this.organizations.findById(actor.organizationId);
    if (!org) throw new NotFoundError("No existe la organización.");
    return { actor, org };
  }

  private async validInvitation(token: string): Promise<OrganizationInvitation> {
    const inv = token ? await this.invitations.findByTokenHash(sha(token)) : undefined;
    if (!inv || inv.status !== "pending" || inv.expiresAt < this.clock.now()) throw new ValidationError("La invitación venció o ya se usó. Pedile a quien te invitó que te mande otra.");
    return inv;
  }

  private async activeMembers(orgId: string): Promise<User[]> {
    return (await this.users.findByOrganization(orgId)).filter((u) => u.status === "active");
  }

  private async pendingInvitations(orgId: string): Promise<OrganizationInvitation[]> {
    const now = this.clock.now();
    return (await this.invitations.findPending(orgId)).filter((i) => i.expiresAt >= now).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Roles de organización cuyos permisos tiene quien los da (sin escalar). */
  private async assignableRoles(actor: User): Promise<Role[]> {
    const perms = await this.authz.permissionsOf(actor);
    return (await this.roleRepo.findAll()).filter((r) => r.scope === "organization" && r.permissions.every((p) => perms.has(p)));
  }

  private async isAdmin(u: User): Promise<boolean> {
    return (await this.authz.permissionsOf(u)).has("users:manage_org");
  }

  private async admins(members: User[]): Promise<User[]> {
    const out: User[] = [];
    for (const m of members) if (await this.isAdmin(m)) out.push(m);
    return out;
  }

  /** Un plan personal pago vigente se cancela antes (si no, se cobraría a la persona y a la organización). */
  private async requireNoPaidPersonalPlan(user: User): Promise<void> {
    const sub = await this.subscriptions.findCurrent({ type: "user", id: user.id });
    const plan = sub && (await this.plans.findById(sub.planId));
    if (sub && plan?.price && !sub.cancelAtPeriodEnd) {
      throw new ValidationError(`Tenés el plan personal ${plan.name}. Cancelalo desde tu cuenta antes de sumarte a un equipo (el equipo paga tu lugar).`);
    }
  }
}

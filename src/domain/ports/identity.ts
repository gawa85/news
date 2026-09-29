import type { ChannelType, Organization, OrganizationInvitation, Permission, Role, User, UserStatus } from "../model";

export interface IUserRepository {
  findById(id: string): Promise<User | undefined>;
  findByChannel(channel: ChannelType, address: string): Promise<User | undefined>;
  findByOrganization(organizationId: string): Promise<User[]>;
  save(user: User): Promise<void>;
  /**
   * Reserva una dirección de canal para un usuario. Falla con ConflictError si ya
   * pertenece a otro usuario (regla: una dirección = un usuario, garantizada por la base).
   */
  claimChannel(userId: string, channel: ChannelType, address: string): Promise<void>;
  /** Libera todas las direcciones del usuario (al borrar sus datos). */
  releaseChannels(userId: string): Promise<void>;
}

/** Buscar personas desde la administración de la plataforma (el resto del sistema no lo necesita). */
export interface IUserDirectory {
  /** Quienes tienen alguno de estos roles (p. ej. el equipo de la plataforma). */
  findWithRoles(roleIds: string[], limit: number): Promise<User[]>;
  findByStatus(status: UserStatus, limit: number): Promise<User[]>;
  /** Completa el índice de roles de cuentas anteriores a que existiera. Idempotente. */
  ensureRoleIndex(): Promise<void>;
}

export interface IRoleRepository {
  findByIds(ids: string[]): Promise<Role[]>;
  findAll(): Promise<Role[]>;
}

export interface IRoleWriter {
  save(role: Role): Promise<void>;
}

export interface IOrganizationRepository {
  findById(id: string): Promise<Organization | undefined>;
  save(org: Organization): Promise<void>;
}

export interface IOrganizationInvitationRepository {
  findById(id: string): Promise<OrganizationInvitation | undefined>;
  findByTokenHash(tokenHash: string): Promise<OrganizationInvitation | undefined>;
  findPending(organizationId: string): Promise<OrganizationInvitation[]>;
  save(invitation: OrganizationInvitation): Promise<void>;
}

/** Resuelve permisos efectivos de un usuario. Hoy por roles; mañana podría sumar ABAC. */
export interface IAuthorizationService {
  permissionsOf(user: User): Promise<ReadonlySet<Permission>>;
}

/** Códigos para verificar que una dirección (mail, número) es del usuario. */
export interface IVerificationCodeService {
  issue(userId: string, channel: ChannelType, address: string): Promise<string>;
  verify(userId: string, channel: ChannelType, address: string, code: string): Promise<boolean>;
}

import type { ChannelType, Organization, Permission, Role, User } from "../model";

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

/** Resuelve permisos efectivos de un usuario. Hoy por roles; mañana podría sumar ABAC. */
export interface IAuthorizationService {
  permissionsOf(user: User): Promise<ReadonlySet<Permission>>;
}

/** Códigos para verificar que una dirección (mail, número) es del usuario. */
export interface IVerificationCodeService {
  issue(userId: string, channel: ChannelType, address: string): Promise<string>;
  verify(userId: string, channel: ChannelType, address: string, code: string): Promise<boolean>;
}

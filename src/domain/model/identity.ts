import type { Permission } from "./permissions";

/** `api`: bots, agentes y clientes MCP que llegan con una clave de API. */
export const CHANNEL_TYPES = ["web", "api", "email", "whatsapp", "telegram", "sms"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

/** Una dirección del usuario en un canal: mail, número de WhatsApp, chat de Telegram... */
export interface ChannelIdentity {
  channel: ChannelType;
  address: string;
  verified: boolean;
  linkedAt: Date;
}

/** `deleted`: la persona pidió borrar sus datos; la cuenta queda anonimizada. */
export type UserStatus = "active" | "suspended" | "deleted";

export interface User {
  id: string;
  name: string;
  status: UserStatus;
  roleIds: string[];
  /** Si pertenece a una organización, usa el plan y las reglas de la organización. */
  organizationId?: string;
  channels: ChannelIdentity[];
  preferredChannel?: ChannelType;
  /** Medios a los que representa (derecho a réplica). Lo asigna un admin de plataforma. */
  representsOutletIds?: string[];
  /** País (ISO 3166-1 alfa-2). Si falta, el país por defecto de la plataforma. */
  country?: string;
  createdAt: Date;
}

export interface Organization {
  id: string;
  name: string;
  /** Tipo: empresa o medio, o escuela (modo aprendizaje, datos mínimos de estudiantes). */
  kind?: "company" | "media" | "school";
  country?: string;
  createdAt: Date;
}

/**
 * Rol = conjunto de permisos con nombre.
 * `scope: "organization"`: lo puede asignar el admin de una organización a sus miembros.
 * `scope: "platform"`: sólo lo asigna un administrador de la plataforma.
 */
export interface Role {
  id: string;
  name: string;
  description: string;
  scope: "platform" | "organization";
  permissions: Permission[];
}

export function verifiedChannels(user: User): ChannelIdentity[] {
  return user.channels.filter((c) => c.verified);
}

export function channelAddress(user: User, channel: ChannelType): string | undefined {
  return user.channels.find((c) => c.channel === channel && c.verified)?.address;
}

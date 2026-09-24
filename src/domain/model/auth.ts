/**
 * LOGIN WEB. Tres formas de entrar, todas terminan en una sesión:
 *  - enlace mágico por mail (sin contraseña),
 *  - contraseña,
 *  - proveedor externo (Google u otro OpenID Connect).
 * De los tokens sólo se guarda el hash.
 */
export interface Session {
  /** Hash del token de sesión. */
  id: string;
  userId: string;
  method: "magic_link" | "password" | "oauth";
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revoked: boolean;
  userAgent?: string;
  ip?: string;
}

export interface PasswordCredential {
  /** Mail en minúsculas. */
  email: string;
  userId: string;
  hash: string;
  updatedAt: Date;
}

export interface MagicLink {
  /** Hash del token. */
  id: string;
  email: string;
  expiresAt: Date;
  usedAt?: Date;
}

export interface OAuthState {
  state: string;
  providerId: string;
  codeVerifier: string;
  redirectAfter?: string;
  expiresAt: Date;
}

export interface LoginAttempt {
  id: string;
  /** Hash del mail o IP: se limita sin guardar el dato. */
  identifierHash: string;
  ok: boolean;
  at: Date;
}

export interface ExternalIdentity {
  providerId: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

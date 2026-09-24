import type { ExternalIdentity, LoginAttempt, MagicLink, OAuthState, PasswordCredential, Session } from "../model";

export interface ISessionRepository {
  findById(id: string): Promise<Session | undefined>;
  findByUser(userId: string): Promise<Session[]>;
  save(session: Session): Promise<void>;
}

export interface ICredentialRepository {
  findByEmail(email: string): Promise<PasswordCredential | undefined>;
  save(cred: PasswordCredential): Promise<void>;
  deleteByUser(userId: string): Promise<void>;
}

export interface IMagicLinkRepository {
  findById(id: string): Promise<MagicLink | undefined>;
  save(link: MagicLink): Promise<void>;
}

export interface IOAuthStateRepository {
  take(state: string): Promise<OAuthState | undefined>;
  save(state: OAuthState): Promise<void>;
}

export interface ILoginAttemptRepository {
  countFailures(identifierHash: string, since: Date): Promise<number>;
  record(attempt: LoginAttempt): Promise<void>;
  deleteOlderThan(date: Date): Promise<void>;
}

/** Hash de contraseñas (scrypt, argon2…). Nunca se guarda la contraseña. */
export interface IPasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}

/** Proveedor de identidad externo (Google, Microsoft, Apple… vía OpenID Connect). */
export interface IOAuthProvider {
  readonly id: string;
  authorizationUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchange(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<ExternalIdentity>;
}

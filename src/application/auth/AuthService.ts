import { createHash, randomBytes } from "node:crypto";
import { AccessDeniedError, ValidationError } from "../../domain/errors";
import type { Session, User } from "../../domain/model";
import type {
  IClock,
  ICredentialRepository,
  IDomainEvents,
  IIdGenerator,
  ILoginAttemptRepository,
  IMagicLinkRepository,
  IOAuthProvider,
  IOAuthStateRepository,
  IPasswordHasher,
  ISessionRepository,
  IUserRepository,
} from "../../domain/ports";
import type { Caller } from "../access/ProductGateway";
import type { NotificationService } from "../messaging/NotificationService";
import type { RegisterUserUseCase } from "../users/RegisterUserUseCase";

export interface AuthOptions {
  publicBaseUrl: string;
  sessionDays: number;
  magicLinkMinutes: number;
  maxFailedLogins: number;
  failedLoginWindowMinutes: number;
  minPasswordLength: number;
}

const DEFAULTS: AuthOptions = {
  publicBaseUrl: "http://localhost:8080",
  sessionDays: 30,
  magicLinkMinutes: 15,
  maxFailedLogins: 5,
  failedLoginWindowMinutes: 15,
  minPasswordLength: 10,
};

const COMMON_PASSWORDS = new Set(["1234567890", "contraseña123", "password123", "qwertyuiop", "12345678910", "argentina123"]);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const normEmail = (e: string) => e.trim().toLowerCase();

/**
 * LOGIN WEB.
 *
 * REGLAS:
 *  - Enlace mágico: un solo uso, vence en 15 min. La respuesta es la misma exista o no
 *    la cuenta (no revela qué mails están registrados).
 *  - Contraseña: mínimo 10 caracteres y no de las más comunes; hash con scrypt.
 *    5 intentos fallidos en 15 min por mail → bloqueo temporal.
 *  - Google u otro proveedor: sólo mails VERIFICADOS por el proveedor; con PKCE y `state` de un solo uso.
 *  - Sesión: token aleatorio (se guarda sólo el hash), vence a los 30 días, se renueva con el uso.
 *  - Usuario suspendido no entra. Todo inicio (y todo fallo) queda en la auditoría.
 */
export class AuthService {
  private readonly opts: AuthOptions;

  constructor(
    private readonly users: IUserRepository,
    private readonly register: RegisterUserUseCase,
    private readonly sessions: ISessionRepository,
    private readonly credentials: ICredentialRepository,
    private readonly magicLinks: IMagicLinkRepository,
    private readonly oauthStates: IOAuthStateRepository,
    private readonly attempts: ILoginAttemptRepository,
    private readonly hasher: IPasswordHasher,
    private readonly providers: IOAuthProvider[],
    private readonly notifications: NotificationService,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    opts: Partial<AuthOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  // ---------------- Enlace mágico ----------------

  async requestMagicLink(email: string): Promise<void> {
    const e = normEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ValidationError("Mail inválido.");
    const t = token();
    await this.magicLinks.save({ id: sha(t), email: e, expiresAt: new Date(this.clock.now().getTime() + this.opts.magicLinkMinutes * 60_000) });
    await this.notifications.sendTo("email", e, {
      kind: "info",
      title: "Tu enlace para entrar a Sin Humo",
      summary: `Entrá con este enlace (vence en ${this.opts.magicLinkMinutes} minutos y sirve una sola vez). Si no lo pediste, ignorá este mail.`,
      sections: [],
      links: [{ label: "Entrar", url: `${this.opts.publicBaseUrl}/auth/magic?token=${t}` }],
    }, "verification");
  }

  async consumeMagicLink(plainToken: string, meta: { userAgent?: string; ip?: string } = {}): Promise<{ token: string; user: User }> {
    const link = await this.magicLinks.findById(sha(plainToken));
    const now = this.clock.now();
    if (!link || link.usedAt || link.expiresAt < now) throw new AccessDeniedError("El enlace es inválido o ya venció. Pedí uno nuevo.", "no_permission");
    await this.magicLinks.save({ ...link, usedAt: now });
    // Hacer clic en el enlace prueba que el mail es suyo.
    const user = await this.userForVerifiedEmail(link.email, link.email.split("@")[0]!);
    return this.startSession(user, "magic_link", meta);
  }

  // ---------------- Contraseña ----------------

  async setPassword(userId: string, email: string, password: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new ValidationError("Usuario inexistente.");
    const e = normEmail(email);
    if (!user.channels.some((c) => c.channel === "email" && c.verified && normEmail(c.address) === e)) {
      throw new ValidationError("Primero verificá ese mail en tu cuenta.");
    }
    if (password.length < this.opts.minPasswordLength) throw new ValidationError(`La contraseña debe tener al menos ${this.opts.minPasswordLength} caracteres.`);
    if (COMMON_PASSWORDS.has(password.toLowerCase())) throw new ValidationError("Esa contraseña es demasiado común.");
    await this.credentials.save({ email: e, userId, hash: await this.hasher.hash(password), updatedAt: this.clock.now() });
  }

  async loginWithPassword(email: string, password: string, meta: { userAgent?: string; ip?: string } = {}): Promise<{ token: string; user: User }> {
    const e = normEmail(email);
    const idHash = sha(`email:${e}`);
    const now = this.clock.now();
    const failures = await this.attempts.countFailures(idHash, new Date(now.getTime() - this.opts.failedLoginWindowMinutes * 60_000));
    if (failures >= this.opts.maxFailedLogins) {
      throw new AccessDeniedError(`Demasiados intentos. Probá de nuevo en ${this.opts.failedLoginWindowMinutes} minutos o entrá con un enlace por mail.`, "too_many_attempts");
    }
    const cred = await this.credentials.findByEmail(e);
    const ok = !!cred && (await this.hasher.verify(password, cred.hash));
    await this.attempts.record({ id: this.ids.next("login"), identifierHash: idHash, ok, at: now });
    const user = ok ? await this.users.findById(cred!.userId) : undefined;
    if (!ok || !user) {
      await this.events.emit("auth.login_failed", { userId: cred?.userId ?? "desconocido" }, { method: "password" });
      throw new AccessDeniedError("Mail o contraseña incorrectos.", "no_permission"); // mismo mensaje en ambos casos
    }
    return this.startSession(user, "password", meta);
  }

  // ---------------- Google / OpenID Connect ----------------

  async startOAuth(providerId: string, redirectAfter?: string): Promise<string> {
    const provider = this.provider(providerId);
    const state = token();
    const codeVerifier = token();
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    await this.oauthStates.save({ state, providerId, codeVerifier, redirectAfter, expiresAt: new Date(this.clock.now().getTime() + 10 * 60_000) });
    return provider.authorizationUrl({ state, codeChallenge, redirectUri: this.redirectUri(providerId) });
  }

  async completeOAuth(providerId: string, state: string, code: string, meta: { userAgent?: string; ip?: string } = {}): Promise<{ token: string; user: User; redirectAfter?: string }> {
    const saved = await this.oauthStates.take(state);
    if (!saved || saved.providerId !== providerId || saved.expiresAt < this.clock.now()) throw new AccessDeniedError("La sesión de inicio expiró. Probá de nuevo.", "no_permission");
    const identity = await this.provider(providerId).exchange({ code, codeVerifier: saved.codeVerifier, redirectUri: this.redirectUri(providerId) });
    if (!identity.emailVerified) throw new AccessDeniedError("El proveedor no confirma que ese mail sea tuyo.", "no_permission");
    const user = await this.userForVerifiedEmail(identity.email, identity.name ?? identity.email);
    return { ...(await this.startSession(user, "oauth", meta)), redirectAfter: saved.redirectAfter };
  }

  // ---------------- Sesiones ----------------

  /** Valida el token de sesión (cookie) y devuelve quién llama por la web. */
  async authenticateSession(plainToken: string | undefined): Promise<Caller> {
    if (!plainToken) throw new AccessDeniedError("Iniciá sesión.", "no_permission");
    const s = await this.sessions.findById(sha(plainToken));
    const now = this.clock.now();
    if (!s || s.revoked || s.expiresAt < now) throw new AccessDeniedError("La sesión venció. Iniciá sesión de nuevo.", "no_permission");
    const user = await this.users.findById(s.userId);
    if (!user || user.status !== "active") throw new AccessDeniedError("La cuenta no está activa.", "user_inactive");
    if (now.getTime() - s.lastSeenAt.getTime() > 3_600_000) {
      await this.sessions.save({ ...s, lastSeenAt: now, expiresAt: new Date(now.getTime() + this.opts.sessionDays * 86_400_000) });
    }
    return { userId: user.id, channel: "web" };
  }

  async logout(plainToken: string): Promise<void> {
    const s = await this.sessions.findById(sha(plainToken));
    if (!s) return;
    await this.sessions.save({ ...s, revoked: true });
    await this.events.emit("auth.logout", { userId: s.userId });
  }

  /** Cerrar todas las sesiones (p. ej. al cambiar la contraseña o si perdió el teléfono). */
  async logoutEverywhere(userId: string): Promise<number> {
    const active = (await this.sessions.findByUser(userId)).filter((s) => !s.revoked);
    for (const s of active) await this.sessions.save({ ...s, revoked: true });
    await this.events.emit("auth.logout", { userId }, { sessions: active.length, everywhere: true });
    return active.length;
  }

  private async startSession(user: User, method: Session["method"], meta: { userAgent?: string; ip?: string }): Promise<{ token: string; user: User }> {
    if (user.status !== "active") throw new AccessDeniedError("La cuenta está suspendida.", "user_inactive");
    const t = token();
    const now = this.clock.now();
    await this.sessions.save({
      id: sha(t), userId: user.id, method, createdAt: now, lastSeenAt: now,
      expiresAt: new Date(now.getTime() + this.opts.sessionDays * 86_400_000), revoked: false,
      userAgent: meta.userAgent?.slice(0, 200), ip: meta.ip,
    });
    await this.events.emit("auth.login", { userId: user.id, organizationId: user.organizationId }, { method });
    return { token: t, user };
  }

  private async userForVerifiedEmail(email: string, name: string): Promise<User> {
    return (await this.users.findByChannel("email", email)) ?? (await this.register.execute({ name, channel: { type: "email", address: email, verified: true } }));
  }

  private provider(id: string): IOAuthProvider {
    const p = this.providers.find((x) => x.id === id);
    if (!p) throw new ValidationError(`Proveedor de inicio de sesión desconocido: ${id}.`);
    return p;
  }

  private redirectUri(providerId: string) {
    return `${this.opts.publicBaseUrl}/auth/${providerId}/callback`;
  }
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { ChannelType, Permission, User } from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IRoleRepository,
  ISecretRecordRepository,
  ISecretVault,
  IVerificationCodeRepository,
  IVerificationCodeService,
} from "../../domain/ports";

/** Permisos efectivos = unión de los permisos de sus roles. Suspendido = ninguno. */
export class RoleBasedAuthorization implements IAuthorizationService {
  constructor(private readonly roles: IRoleRepository) {}

  async permissionsOf(user: User): Promise<ReadonlySet<Permission>> {
    if (user.status !== "active") return new Set();
    const roles = await this.roles.findByIds(user.roleIds);
    return new Set(roles.flatMap((r) => r.permissions));
  }
}

/**
 * Códigos de verificación de 6 dígitos. Se guarda sólo el hash, vencen a los
 * 10 minutos y se invalidan después de 5 intentos fallidos.
 */
export class HashedVerificationCodeService implements IVerificationCodeService {
  constructor(
    private readonly repo: IVerificationCodeRepository,
    private readonly clock: IClock,
    private readonly ttlMinutes = 10,
    private readonly maxAttempts = 5,
  ) {}

  async issue(userId: string, channel: ChannelType, address: string): Promise<string> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.repo.save({
      key: this.key(userId, channel, address),
      codeHash: sha(code),
      expiresAt: new Date(this.clock.now().getTime() + this.ttlMinutes * 60_000),
      attempts: 0,
    });
    return code;
  }

  async verify(userId: string, channel: ChannelType, address: string, code: string): Promise<boolean> {
    const key = this.key(userId, channel, address);
    const rec = await this.repo.get(key);
    if (!rec || rec.expiresAt < this.clock.now() || rec.attempts >= this.maxAttempts) return false;
    const ok = timingSafeEqual(Buffer.from(rec.codeHash), Buffer.from(sha(code.trim())));
    if (ok) await this.repo.delete(key);
    else await this.repo.save({ ...rec, attempts: rec.attempts + 1 });
    return ok;
  }

  private key(userId: string, channel: string, address: string) {
    return `${userId}:${channel}:${address.trim().toLowerCase()}`;
  }
}

/**
 * Bóveda de secretos con AES-256-GCM. La clave maestra viene de una variable de
 * entorno o de un servicio de claves; en la base sólo queda texto cifrado.
 */
export class EncryptedSecretVault implements ISecretVault {
  private readonly key: Buffer;

  constructor(
    private readonly records: ISecretRecordRepository,
    masterKey: string,
    private readonly clock: IClock,
  ) {
    if (masterKey.length < 16) throw new Error("La clave maestra de la bóveda es demasiado corta.");
    this.key = createHash("sha256").update(masterKey).digest();
  }

  async put(plaintext: string): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const ref = `sec_${randomBytes(12).toString("base64url")}`;
    const ciphertext = [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
    await this.records.save({ ref, ciphertext, createdAt: this.clock.now() });
    return ref;
  }

  async get(ref: string): Promise<string | undefined> {
    const rec = await this.records.get(ref);
    if (!rec) return undefined;
    const [iv, tag, enc] = rec.ciphertext.split(".").map((p) => Buffer.from(p, "base64")) as [Buffer, Buffer, Buffer];
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  }

  delete(ref: string): Promise<void> {
    return this.records.delete(ref);
  }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

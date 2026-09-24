import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { ExternalIdentity } from "../../domain/model";
import type { IHttpClient, IOAuthProvider, IPasswordHasher } from "../../domain/ports";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/** scrypt (incluido en Node). Formato: scrypt$N$r$p$sal$hash. Los parámetros viajan en el hash: se pueden subir sin romper los viejos. */
export class ScryptPasswordHasher implements IPasswordHasher {
  constructor(private readonly params = { N: 2 ** 15, r: 8, p: 1 }) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const { N, r, p } = this.params;
    const key = await scrypt(password.normalize("NFKC"), salt, 32, { N, r, p, maxmem: 128 * N * r * 2 });
    return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const [alg, N, r, p, salt, hash] = stored.split("$");
    if (alg !== "scrypt" || !salt || !hash) return false;
    const expected = Buffer.from(hash, "base64");
    const n = Number(N);
    const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, { N: n, r: Number(r), p: Number(p), maxmem: 128 * n * Number(r) * 2 });
    return timingSafeEqual(key, expected);
  }
}

/**
 * Google (OpenID Connect) con PKCE. Endpoints oficiales:
 * autorización accounts.google.com, token oauth2.googleapis.com, datos openidconnect.googleapis.com.
 */
export class GoogleOAuthProvider implements IOAuthProvider {
  readonly id = "google";

  constructor(
    private readonly http: IHttpClient,
    private readonly cfg: { clientId: string; clientSecret: string },
  ) {}

  authorizationUrl(i: { state: string; codeChallenge: string; redirectUri: string }): string {
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: i.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state: i.state,
      code_challenge: i.codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  async exchange(i: { code: string; codeVerifier: string; redirectUri: string }): Promise<ExternalIdentity> {
    const body = new URLSearchParams({
      code: i.code,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      redirect_uri: i.redirectUri,
      grant_type: "authorization_code",
      code_verifier: i.codeVerifier,
    }).toString();
    const tok = await this.http.send("POST", "https://oauth2.googleapis.com/token", body, { "content-type": "application/x-www-form-urlencoded" });
    if (tok.status !== 200) throw new Error(`Google rechazó el código (${tok.status}).`);
    const { access_token } = JSON.parse(tok.text) as { access_token: string };
    const info = await this.http.get("https://openidconnect.googleapis.com/v1/userinfo", { authorization: `Bearer ${access_token}` });
    if (info.status !== 200) throw new Error(`No se pudieron leer los datos de Google (${info.status}).`);
    const u = JSON.parse(info.text) as { sub: string; email: string; email_verified: boolean; name?: string };
    return { providerId: this.id, subject: u.sub, email: u.email, emailVerified: !!u.email_verified, name: u.name };
  }
}

/**
 * Adaptadores contra el abuso: verificadores de captcha y señales. Todos intercambiables.
 */
import type { AbuseContext, AbuseSignal } from "../../domain/model";
import type { IAbuseSignalProvider, ICaptchaVerifier } from "../../domain/ports";

type FetchFn = typeof fetch;

// ---------------- Captcha ----------------

/** Turnstile y hCaptcha verifican igual: POST del secreto + token + IP, responden {success}. */
abstract class SiteVerifyCaptcha implements ICaptchaVerifier {
  abstract readonly id: string;
  protected abstract readonly url: string;

  constructor(
    private readonly secret: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async verify(token: string, ip?: string): Promise<{ ok: boolean; error?: string }> {
    if (!token) return { ok: false, error: "missing-input-response" };
    const body = new URLSearchParams({ secret: this.secret, response: token, ...(ip ? { remoteip: ip } : {}) });
    try {
      const res = await this.fetchFn(this.url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(8_000) });
      const out = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
      return out.success ? { ok: true } : { ok: false, error: out["error-codes"]?.join(",") || "invalid" };
    } catch (e) {
      // Si el proveedor no responde, no se deja pasar (es la puerta de las cuentas nuevas).
      return { ok: false, error: `unavailable: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

/** Cloudflare Turnstile (gratis y sin rompecabezas para la mayoría). */
export class TurnstileCaptcha extends SiteVerifyCaptcha {
  readonly id = "turnstile";
  protected readonly url = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
}

export class HCaptcha extends SiteVerifyCaptcha {
  readonly id = "hcaptcha";
  protected readonly url = "https://api.hcaptcha.com/siteverify";
}

/** Para tests y desarrollo: acepta un token fijo. */
export class FakeCaptcha implements ICaptchaVerifier {
  readonly id = "fake-captcha";
  readonly checked: string[] = [];

  constructor(private readonly validToken = "captcha-ok") {}

  async verify(token: string): Promise<{ ok: boolean; error?: string }> {
    this.checked.push(token);
    return token === this.validToken ? { ok: true } : { ok: false, error: "invalid" };
  }
}

// ---------------- Señales ----------------

/** Mails descartables: suelen ser cuentas para abusar del plan gratis. */
export class DisposableEmailSignalProvider implements IAbuseSignalProvider {
  readonly id = "mail_descartable";
  private readonly domains: Set<string>;

  constructor(domains: Iterable<string>) {
    this.domains = new Set([...domains].map((d) => d.trim().toLowerCase()).filter(Boolean));
  }

  async inspect(ctx: AbuseContext): Promise<AbuseSignal[]> {
    if (!ctx.email || !["signup", "magic_link"].includes(ctx.action)) return [];
    const domain = ctx.email.split("@")[1]?.trim().toLowerCase() ?? "";
    // También los subdominios (x.mailinator.com).
    const hit = [...this.domains].some((d) => domain === d || domain.endsWith(`.${d}`));
    // Se rechaza (no alcanza con un captcha: el problema es el mail, no si es una persona).
    return hit ? [{ type: "disposable_email", weight: 90, detail: "Los mails temporales no están permitidos." }] : [];
  }
}

const HEADLESS = /(headlesschrome|phantomjs|selenium|puppeteer|playwright|webdriver|python-requests|python-urllib|curl\/|wget\/|go-http-client|okhttp|java\/|libwww-perl|scrapy|httpclient)/i;

/**
 * Pantallas web (alta, acceso) usadas por un programa. En la API y el MCP los programas
 * son bienvenidos (para eso están las claves): ahí no aplica.
 */
export class AutomationSignalProvider implements IAbuseSignalProvider {
  readonly id = "automatizado";

  async inspect(ctx: AbuseContext): Promise<AbuseSignal[]> {
    if (!["signup", "login", "magic_link"].includes(ctx.action)) return [];
    if (!ctx.userAgent?.trim()) return [{ type: "automation", weight: 40, detail: "El navegador no se identificó." }];
    if (HEADLESS.test(ctx.userAgent)) return [{ type: "automation", weight: 60, detail: "Parece un programa automatizado." }];
    return [];
  }
}

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ValidationError } from "../../domain/errors";
import type { HttpResponse, IHttpClient } from "../../domain/ports";
import { isPublicAddress } from "../../domain/rules/network";
import type { Resolver } from "../evidence/HttpPageCapturer";

const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Decorador de IHttpClient para destinos que elige una PERSONA (webhooks): sólo https y
 * nombres que resuelven a IPs públicas. Así nadie puede usar el servidor para pegarle a la
 * red interna, a la base o a los metadatos de la nube. El cliente de adentro NO debe seguir
 * redirecciones (un 3xx podría llevar a una IP interna): usar FetchHttpClient con followRedirects: false.
 *
 * Opciones:
 *  - `allowPrivate`: sólo en desarrollo (probar webhooks contra localhost).
 *  - `allowHttp`: aceptar http además de https (feeds RSS: muchos siguen en http).
 *  - `maxRedirects`: en GET, seguir redirecciones CONTROLANDO CADA SALTO (un feed público puede
 *    redirigir a una IP interna). En envíos (webhooks) nunca se siguen.
 */
export class PublicDestinationHttpClient implements IHttpClient {
  constructor(
    private readonly inner: IHttpClient,
    private readonly opts: { allowPrivate?: boolean; allowHttp?: boolean; maxRedirects?: number } = {},
    private readonly resolve: Resolver = dnsResolver,
  ) {}

  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    let current = url;
    for (let hop = 0; ; hop++) {
      await this.check(current);
      const res = await this.inner.get(current, headers);
      const location = res.headers.location ?? res.headers.Location;
      if (res.status < 300 || res.status >= 400 || !location || hop >= (this.opts.maxRedirects ?? 0)) return res;
      current = new URL(location, current).toString();
    }
  }

  async send(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse> {
    await this.check(url);
    return this.inner.send(method, url, body, headers);
  }

  private async check(raw: string): Promise<void> {
    if (this.opts.allowPrivate) return;
    const url = new URL(raw);
    const okProtocol = url.protocol === "https:" || (this.opts.allowHttp && url.protocol === "http:");
    if (!okProtocol) throw new ValidationError(this.opts.allowHttp ? "Sólo direcciones web (http o https)." : "Sólo se envía a direcciones https.");
    if (url.port && !["80", "443"].includes(url.port)) throw new ValidationError("Sólo se usan los puertos web estándar.");
    if (url.username || url.password) throw new ValidationError("La dirección no puede llevar usuario ni clave.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const ips = isIP(host) ? [host] : await this.resolve(host).catch(() => []);
    if (!ips.length) throw new ValidationError(`No existe el sitio ${host}.`);
    if (!ips.every(isPublicAddress)) throw new ValidationError("Esa dirección no es pública: no se accede a redes internas.");
  }
}

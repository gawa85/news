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
 * `allowPrivate`: sólo en desarrollo (probar webhooks contra localhost).
 */
export class PublicDestinationHttpClient implements IHttpClient {
  constructor(
    private readonly inner: IHttpClient,
    private readonly opts: { allowPrivate?: boolean } = {},
    private readonly resolve: Resolver = dnsResolver,
  ) {}

  async get(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
    await this.check(url);
    return this.inner.get(url, headers);
  }

  async send(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse> {
    await this.check(url);
    return this.inner.send(method, url, body, headers);
  }

  private async check(raw: string): Promise<void> {
    if (this.opts.allowPrivate) return;
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new ValidationError("Sólo se envía a direcciones https.");
    if (url.username || url.password) throw new ValidationError("La dirección no puede llevar usuario ni clave.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const ips = isIP(host) ? [host] : await this.resolve(host).catch(() => []);
    if (!ips.length) throw new ValidationError(`No existe el sitio ${host}.`);
    if (!ips.every(isPublicAddress)) throw new ValidationError("Esa dirección no es pública: no se envían avisos a redes internas.");
  }
}

/**
 * Descarga de páginas para archivar, con protección SSRF: la URL la manda cualquier persona,
 * así que no se puede usar para llegar a la red interna ni a los metadatos de la nube
 * (169.254.169.254). Cada salto de una redirección se vuelve a controlar.
 *
 * Límite conocido: entre la consulta DNS y la conexión, un DNS malicioso podría cambiar la
 * IP ("DNS rebinding"). Para cerrarlo del todo, correr esto detrás de un proxy de salida
 * que sólo permita IPs públicas.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPublicAddress } from "../../domain/rules/network";
import { htmlToText } from "../text/HtmlText";
import { ValidationError } from "../../domain/errors";
import type { CapturedPage, IPageCapturer } from "../../domain/ports";

/** (Se re-exporta: antes vivía acá.) */
export { isPublicAddress };

type FetchFn = typeof fetch;
/** Todas las IPs de un nombre (inyectable para tests). */
export type Resolver = (host: string) => Promise<string[]>;

const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** (Se re-exporta: el conversor lineal vive en text/HtmlText.) */
export { htmlToText };

export class HttpPageCapturer implements IPageCapturer {
  readonly id = "http";

  constructor(
    private readonly opts: { timeoutMs?: number; maxRedirects?: number; userAgent?: string } = {},
    private readonly resolve: Resolver = dnsResolver,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  /** Sólo http(s), puertos estándar y nombres que resuelvan a IPs públicas. */
  private async check(url: URL): Promise<void> {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new ValidationError("Sólo se pueden archivar páginas http o https.");
    if (url.username || url.password) throw new ValidationError("La dirección no puede llevar usuario ni clave.");
    if (url.port && !["80", "443"].includes(url.port)) throw new ValidationError("Sólo se archivan páginas en los puertos web estándar.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const ips = isIP(host) ? [host] : await this.resolve(host).catch(() => []);
    if (ips.length === 0) throw new ValidationError(`No existe el sitio ${host}.`);
    if (!ips.every(isPublicAddress)) throw new ValidationError("Esa dirección no es una página pública de internet.");
  }

  async capture(rawUrl: string, maxBytes: number): Promise<CapturedPage> {
    let url = new URL(rawUrl);
    for (let hop = 0; ; hop++) {
      await this.check(url);
      const res = await this.fetchFn(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
        headers: { "user-agent": this.opts.userAgent ?? "SinHumoArchivo/1.0 (+https://sinhumo.example/archivo)", accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        if (hop >= (this.opts.maxRedirects ?? 5)) throw new ValidationError("Demasiadas redirecciones.");
        url = new URL(location, url);
        continue;
      }
      const body = await readCapped(res, maxBytes);
      const mime = res.headers.get("content-type") ?? "application/octet-stream";
      const isText = /^(text\/html|application\/xhtml\+xml|text\/plain)/i.test(mime);
      const decoded = isText ? body.toString("utf8") : "";
      const { title, text } = /html/i.test(mime) ? htmlToText(decoded) : { title: undefined, text: decoded };
      return { finalUrl: url.toString(), status: res.status, mime, body, title, text };
    }
  }
}

/** Lee el cuerpo cortando apenas se pasa del máximo (no se baja un archivo gigante entero). */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new ValidationError("La página es demasiado grande para archivarla.");
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) throw new ValidationError("La página es demasiado grande para archivarla.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

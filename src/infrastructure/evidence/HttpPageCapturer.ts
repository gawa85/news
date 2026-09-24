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
import { ValidationError } from "../../domain/errors";
import type { CapturedPage, IPageCapturer } from "../../domain/ports";

type FetchFn = typeof fetch;
/** Todas las IPs de un nombre (inyectable para tests). */
export type Resolver = (host: string) => Promise<string[]>;

const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
];

/** ¿Es una dirección de internet pública? (no interna, local, de enlace, multicast ni reservada) */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return !V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (ipv4ToInt(base) >>> (32 - bits)));
  }
  if (kind === 6) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (v === "::" || v === "::1") return false;
    const first = parseInt(v.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 privadas
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 de enlace
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (v.startsWith("64:ff9b:") || v.startsWith("2001:db8:")) return false; // traducción / documentación
    return true;
  }
  return false;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)));

/** Texto visible de un HTML: sin scripts, estilos ni comentarios; un bloque por línea. */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/blockquote|\/article|\/section|\/header|\/footer)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return {
    title: title ? decodeEntities(title).replace(/\s+/g, " ").trim() : undefined,
    text: decodeEntities(body).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"),
  };
}

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

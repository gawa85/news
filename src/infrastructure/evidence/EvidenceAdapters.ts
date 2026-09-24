/**
 * ARCHIVO DE EVIDENCIAS: adaptadores de terceros (sello de tiempo, archivo público) y
 * versiones falsas para tests. Todos intercambiables detrás de los puertos del dominio.
 */
import { randomBytes } from "node:crypto";
import type { CapturedPage, IExternalArchive, IHttpClient, IPageCapturer, ITimestampAuthority } from "../../domain/ports";

type FetchFn = typeof fetch;

// ---------------- Sello de tiempo (RFC 3161) ----------------

/** OID de SHA-256 (2.16.840.1.101.3.4.2.1) como AlgorithmIdentifier, con parámetros NULL. */
const SHA256_ALGORITHM = Buffer.from("300d06096086480165030402010500", "hex");

/** TimeStampReq en DER: versión 1, huella SHA-256, nonce y pedido del certificado. */
export function buildTimestampRequest(sha256Hex: string, nonce: Buffer = randomBytes(8)): Buffer {
  const hash = Buffer.from(sha256Hex, "hex");
  if (hash.length !== 32) throw new Error("La huella tiene que ser SHA-256 (64 caracteres hex).");
  const n = Buffer.from(nonce);
  n[0] = n[0]! & 0x7f; // INTEGER positivo
  const imprint = Buffer.concat([SHA256_ALGORITHM, Buffer.from([0x04, 0x20]), hash]);
  const body = Buffer.concat([
    Buffer.from([0x02, 0x01, 0x01]), // version
    Buffer.from([0x30, imprint.length]), imprint, // messageImprint
    Buffer.from([0x02, n.length]), n, // nonce
    Buffer.from([0x01, 0x01, 0xff]), // certReq TRUE
  ]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

/** Largo DER a partir de `i` (el byte de largo). Devuelve el largo y dónde empieza el valor. */
function derLength(buf: Buffer, i: number): { len: number; start: number } {
  const first = buf[i]!;
  if (first < 0x80) return { len: first, start: i + 1 };
  const n = first & 0x7f;
  let len = 0;
  for (let k = 0; k < n; k++) len = len * 256 + buf[i + 1 + k]!;
  return { len, start: i + 1 + n };
}

/**
 * Lectura mínima de TimeStampResp: estado (0 = otorgado, 1 = otorgado con cambios) y hora
 * (el primer GeneralizedTime del token es genTime). La verificación criptográfica completa
 * se hace por fuera con el token guardado: `openssl ts -verify`.
 */
export function parseTimestampResponse(resp: Buffer, sha256Hex: string): { status: number; at?: Date } {
  if (resp[0] !== 0x30) throw new Error("Respuesta de sello inválida.");
  const outer = derLength(resp, 1);
  if (resp[outer.start] !== 0x30) throw new Error("Respuesta de sello inválida.");
  const info = derLength(resp, outer.start + 1);
  if (resp[info.start] !== 0x02) throw new Error("Respuesta de sello inválida.");
  const st = derLength(resp, info.start + 1);
  const status = resp[st.start + st.len - 1]!;
  if (status > 1) return { status };
  if (!resp.includes(Buffer.from(sha256Hex, "hex"))) throw new Error("El sello no corresponde a la huella pedida.");
  for (let i = 0; i < resp.length - 16; i++) {
    if (resp[i] !== 0x18) continue;
    const len = resp[i + 1]!;
    const s = resp.subarray(i + 2, i + 2 + len).toString("latin1");
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?Z$/.exec(s);
    if (m) return { status, at: new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ?? ""}Z`) };
  }
  return { status };
}

/** Autoridad de sellado RFC 3161 (FreeTSA, DigiCert, la de un certificador licenciado…). */
export class Rfc3161TimestampAuthority implements ITimestampAuthority {
  readonly id: string;

  constructor(
    private readonly cfg: { url: string; id?: string; headers?: Record<string, string> },
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.id = cfg.id ?? new URL(cfg.url).hostname;
  }

  async stamp(sha256Hex: string): Promise<{ token: string; at: Date }> {
    const res = await this.fetchFn(this.cfg.url, {
      method: "POST",
      headers: { "content-type": "application/timestamp-query", ...this.cfg.headers },
      body: new Uint8Array(buildTimestampRequest(sha256Hex)),
    });
    if (!res.ok) throw new Error(`La autoridad de sellado respondió HTTP ${res.status}.`);
    const resp = Buffer.from(await res.arrayBuffer());
    const parsed = parseTimestampResponse(resp, sha256Hex);
    if (parsed.status > 1) throw new Error(`La autoridad de sellado rechazó el pedido (estado ${parsed.status}).`);
    return { token: resp.toString("base64"), at: parsed.at ?? new Date() };
  }
}

// ---------------- Archivo público ----------------

/**
 * Wayback Machine ("Save Page Now"). Sin claves funciona con límites bajos; con claves
 * (archive.org → S3 keys) se pasan en `auth` ("clave:secreto").
 */
export class WaybackMachineArchive implements IExternalArchive {
  readonly id = "wayback";

  constructor(
    private readonly http: IHttpClient,
    private readonly auth?: string,
  ) {}

  async archive(url: string): Promise<{ url: string; at: Date }> {
    const res = await this.http.get(`https://web.archive.org/save/${url}`, this.auth ? { authorization: `LOW ${this.auth}` } : {});
    if (res.status >= 400) throw new Error(`Wayback Machine respondió HTTP ${res.status}.`);
    const loc = res.headers["content-location"] ?? res.headers["location"];
    const m = loc ? /\/web\/(\d{14})\//.exec(loc) : null;
    if (!loc || !m) throw new Error("Wayback Machine no devolvió la copia.");
    const [, ts] = m;
    const at = new Date(`${ts!.slice(0, 4)}-${ts!.slice(4, 6)}-${ts!.slice(6, 8)}T${ts!.slice(8, 10)}:${ts!.slice(10, 12)}:${ts!.slice(12, 14)}Z`);
    return { url: new URL(loc, "https://web.archive.org").toString(), at };
  }
}

// ---------------- Para demo y tests ----------------

/** Páginas cargadas a mano (se pueden editar o borrar para simular ediciones silenciosas). */
export class FakePageCapturer implements IPageCapturer {
  readonly id = "fake";
  readonly pages = new Map<string, { status: number; title?: string; html: string }>();
  readonly calls: string[] = [];

  set(url: string, title: string, paragraphs: string[], status = 200): void {
    this.pages.set(url, { status, title, html: `<html><head><title>${title}</title></head><body>${paragraphs.map((p) => `<p>${p}</p>`).join("")}</body></html>` });
  }

  async capture(url: string, maxBytes: number): Promise<CapturedPage> {
    this.calls.push(url);
    // Como un sitio real, ignora los parámetros de la dirección si no hay una página exacta.
    const p = this.pages.get(url) ?? this.pages.get(url.split("?")[0]!);
    if (!p) return { finalUrl: url, status: 404, mime: "text/html", body: Buffer.from("No encontrada"), text: "" };
    const body = Buffer.from(p.html);
    if (body.length > maxBytes) throw new Error("Página demasiado grande.");
    const text = p.html.replace(/<title>.*?<\/title>/s, "").replace(/<\/p>/g, "\n").replace(/<[^>]+>/g, "");
    return { finalUrl: url, status: p.status, mime: "text/html; charset=utf-8", body, title: p.title, text };
  }
}

export class FakeTimestampAuthority implements ITimestampAuthority {
  readonly id = "fake-tsa";
  readonly stamped: string[] = [];
  fail = false;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async stamp(sha256Hex: string): Promise<{ token: string; at: Date }> {
    if (this.fail) throw new Error("Autoridad de sellado caída.");
    this.stamped.push(sha256Hex);
    return { token: Buffer.from(`TSA:${sha256Hex}`).toString("base64"), at: this.now() };
  }
}

export class FakeExternalArchive implements IExternalArchive {
  readonly id = "fake-archive";
  readonly archived: string[] = [];

  async archive(url: string): Promise<{ url: string; at: Date }> {
    this.archived.push(url);
    return { url: `https://archivo.example/${encodeURIComponent(url)}`, at: new Date() };
  }
}

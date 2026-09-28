/**
 * Lector LOCAL de imágenes y videos (sin servicios externos):
 *  - JPEG: EXIF (fecha, cámara, programa, GPS), XMP (herramienta, marca de IA de IPTC) y C2PA (APP11/JUMBF).
 *  - PNG: bloques de texto (los generadores de IA escriben ahí sus parámetros), EXIF y C2PA (caBX).
 *  - WebP: EXIF y XMP.
 *  - MP4/MOV: fecha de creación, programa que lo codificó y si trae ubicación.
 *  - Huella perceptual de imágenes (dHash de 64 bits): resiste recompresión y cambio de tamaño.
 */
import { createHash } from "node:crypto";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import type { MediaInspection } from "../../domain/model";
import type { IMediaInspector } from "../../domain/ports";

type Meta = Omit<MediaInspection, "kind" | "mime" | "bytes" | "sha256">;

/** IPTC DigitalSourceType: el estándar que usan los generadores para marcar contenido de IA. */
const IPTC_AI = /digitalsourcetype\/(trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia)/i;

export class LocalMediaInspector implements IMediaInspector {
  constructor(private readonly opts: { maxDecodeMegapixels?: number } = {}) {}

  async inspect(data: Buffer, mime: string): Promise<MediaInspection | undefined> {
    const sha256 = createHash("sha256").update(data).digest("hex");
    const base = { mime, bytes: data.length, sha256 };
    try {
      const maxMp = this.opts.maxDecodeMegapixels ?? 24;
      if (isJpeg(data)) return { kind: "image", ...base, ...readJpeg(data), perceptualHash: this.hash(() => decodeJpeg(data, maxMp)) };
      if (isPng(data)) return { kind: "image", ...base, ...readPng(data), perceptualHash: this.hash(() => decodePng(data, maxMp)) };
      if (isWebp(data)) return { kind: "image", ...base, ...readWebp(data) };
      if (isIsoMedia(data)) return { kind: "video", ...base, ...readIsoMedia(data) };
    } catch {
      // Archivo raro o dañado: igual sirve la huella exacta.
    }
    if (mime.startsWith("image/")) return { kind: "image", ...base };
    if (mime.startsWith("video/")) return { kind: "video", ...base };
    return undefined;
  }

  private hash(decode: () => { width: number; height: number; data: Uint8Array }): string | undefined {
    try {
      return dHash(decode());
    } catch {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------- huella perceptual

/** dHash: gris, 9×8 promediando, y cada bit dice si un punto es más claro que el de al lado. */
export function dHash(img: { width: number; height: number; data: Uint8Array }): string {
  const W = 9;
  const H = 8;
  const gray = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * img.width) / W);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / W));
      const y0 = Math.floor((y * img.height) / H);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / H));
      let sum = 0;
      let n = 0;
      // Muestreo (hasta 16×16 puntos por celda): suficiente y rápido para fotos grandes.
      const sx = Math.max(1, Math.floor((x1 - x0) / 16));
      const sy = Math.max(1, Math.floor((y1 - y0) / 16));
      for (let yy = y0; yy < y1; yy += sy) {
        for (let xx = x0; xx < x1; xx += sx) {
          const i = (yy * img.width + xx) * 4;
          sum += 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
          n++;
        }
      }
      gray[y * W + x] = sum / n;
    }
  }
  let hex = "";
  for (let y = 0; y < H; y++) {
    let byte = 0;
    for (let x = 0; x < 8; x++) byte = (byte << 1) | (gray[y * W + x]! > gray[y * W + x + 1]! ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function decodeJpeg(data: Buffer, maxMp: number) {
  const img = jpeg.decode(data, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: maxMp, maxMemoryUsageInMB: 512 });
  return { width: img.width, height: img.height, data: img.data };
}

/**
 * Un PNG chico puede declarar 100.000 × 100.000 píxeles ("bomba de descompresión"): se mira el
 * tamaño declarado ANTES de decodificar y, si es enorme, no se decodifica (sin huella perceptual).
 */
function decodePng(data: Buffer, maxMp: number) {
  const w = data.readUInt32BE(16);
  const h = data.readUInt32BE(20);
  if (!w || !h || (w * h) / 1e6 > maxMp) throw new Error("Imagen demasiado grande para decodificar.");
  const img = PNG.sync.read(data);
  return { width: img.width, height: img.height, data: img.data };
}

// ---------------------------------------------------------------- formatos

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
const isPng = (b: Buffer) => b.length > 8 && b.toString("latin1", 1, 4) === "PNG";
const isWebp = (b: Buffer) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP";
const isIsoMedia = (b: Buffer) => b.length > 12 && b.toString("latin1", 4, 8) === "ftyp";

function merge(into: Meta, from: Meta): Meta {
  return {
    ...into,
    ...Object.fromEntries(Object.entries(from).filter(([k, v]) => v !== undefined && !["software", "aiMarkers"].includes(k))),
    software: [...new Set([...(into.software ?? []), ...(from.software ?? [])])],
    aiMarkers: [...new Set([...(into.aiMarkers ?? []), ...(from.aiMarkers ?? [])])],
    contentCredentials: into.contentCredentials?.present ? into.contentCredentials : from.contentCredentials ?? into.contentCredentials,
  };
}

function tidy(m: Meta): Meta {
  return { ...m, software: m.software?.length ? m.software : undefined, aiMarkers: m.aiMarkers?.length ? m.aiMarkers : undefined };
}

function readJpeg(b: Buffer): Meta {
  let meta: Meta = {};
  let p = 2;
  while (p + 4 <= b.length && b[p] === 0xff) {
    const marker = b[p + 1]!;
    if (marker === 0xd9 || marker === 0xda) break; // fin o comienzo de la imagen
    const len = b.readUInt16BE(p + 2);
    const seg = b.subarray(p + 4, p + 2 + len);
    if (marker === 0xc0 || marker === 0xc2) meta = merge(meta, { height: seg.readUInt16BE(1), width: seg.readUInt16BE(3) });
    if (marker === 0xe1 && seg.toString("latin1", 0, 6) === "Exif\0\0") meta = merge(meta, readTiff(seg.subarray(6)));
    if (marker === 0xe1 && seg.toString("latin1", 0, 28).startsWith("http://ns.adobe.com/xap/1.0/")) meta = merge(meta, readXmp(seg.toString("utf8")));
    if (marker === 0xeb && /jumb|c2pa/i.test(seg.toString("latin1"))) meta = merge(meta, { contentCredentials: { present: true, generator: c2paGenerator(seg) } });
    p += 2 + len;
  }
  return tidy(meta);
}

function readPng(b: Buffer): Meta {
  let meta: Meta = { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  let p = 8;
  while (p + 8 <= b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString("latin1", p + 4, p + 8);
    const chunk = b.subarray(p + 8, p + 8 + len);
    if (type === "tEXt" || type === "iTXt") {
      const text = chunk.toString(type === "iTXt" ? "utf8" : "latin1");
      const [key, ...rest] = text.split("\0");
      const value = rest.join(" ").trim();
      if (key === "Software") meta = merge(meta, { software: [value] });
      // Los generadores (Stable Diffusion, ComfyUI) guardan acá el pedido que usaron.
      if (/^(parameters|prompt|workflow|Dream|sd-metadata)$/i.test(key ?? "")) meta = merge(meta, { aiMarkers: ["parámetros de un generador de imágenes"] });
      if (key === "XML:com.adobe.xmp") meta = merge(meta, readXmp(value));
    }
    if (type === "eXIf") meta = merge(meta, readTiff(chunk));
    if (type === "caBX") meta = merge(meta, { contentCredentials: { present: true, generator: c2paGenerator(chunk) } });
    if (type === "IEND") break;
    p += 12 + len;
  }
  return tidy(meta);
}

function readWebp(b: Buffer): Meta {
  let meta: Meta = {};
  let p = 12;
  while (p + 8 <= b.length) {
    const type = b.toString("latin1", p, p + 4);
    const len = b.readUInt32LE(p + 4);
    const chunk = b.subarray(p + 8, p + 8 + len);
    if (type === "EXIF") meta = merge(meta, readTiff(chunk.toString("latin1", 0, 6) === "Exif\0\0" ? chunk.subarray(6) : chunk));
    if (type === "XMP ") meta = merge(meta, readXmp(chunk.toString("utf8")));
    p += 8 + len + (len % 2);
  }
  return tidy(meta);
}

function readXmp(xml: string): Meta {
  const tool = /CreatorTool(?:="|>)([^"<]+)/i.exec(xml)?.[1];
  const agent = [...xml.matchAll(/softwareAgent(?:="|>)([^"<]+)/gi)].map((m) => m[1]!.trim());
  const ai = IPTC_AI.test(xml) ? ["marca estándar de contenido generado por IA (IPTC)"] : [];
  const date = /(?:DateCreated|CreateDate)(?:="|>)([^"<]+)/i.exec(xml)?.[1];
  const captured = date ? new Date(date) : undefined;
  return {
    software: [...(tool ? [tool.trim()] : []), ...agent],
    aiMarkers: ai,
    ...(captured && !Number.isNaN(captured.getTime()) ? { capturedAt: captured } : {}),
    ...(/c2pa|contentauth/i.test(xml) ? { contentCredentials: { present: true } } : {}),
  };
}

/** Del manifiesto C2PA sólo se lee el generador declarado (no se verifica la firma). */
function c2paGenerator(seg: Buffer): string | undefined {
  const s = seg.toString("latin1");
  return /claim_generator[^A-Za-z0-9]{0,8}([A-Za-z][\w .\-/]{2,60})/.exec(s)?.[1]?.trim();
}

// ---------------------------------------------------------------- EXIF (TIFF)

function readTiff(t: Buffer): Meta {
  if (t.length < 8) return {};
  const le = t.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const str = (o: number, n: number) => t.toString("latin1", o, o + n).replace(/\0+$/, "").trim();
  const entries = (ifd: number): Map<number, { type: number; count: number; valueAt: number }> => {
    const out = new Map<number, { type: number; count: number; valueAt: number }>();
    if (ifd <= 0 || ifd + 2 > t.length) return out;
    const n = u16(ifd);
    for (let i = 0; i < n && ifd + 2 + i * 12 + 12 <= t.length; i++) {
      const e = ifd + 2 + i * 12;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = ([0, 1, 1, 2, 4, 8][type] ?? 1) * count;
      out.set(u16(e), { type, count, valueAt: size > 4 ? u32(e + 8) : e + 8 });
    }
    return out;
  };
  const ascii = (m: Map<number, { count: number; valueAt: number }>, tag: number) => {
    const e = m.get(tag);
    return e && e.valueAt + e.count <= t.length ? str(e.valueAt, e.count) : undefined;
  };
  const ifd0 = entries(u32(4));
  const exifPtr = ifd0.get(0x8769);
  const exif = exifPtr ? entries(u32(exifPtr.valueAt)) : new Map();
  const make = ascii(ifd0, 0x010f);
  const model = ascii(ifd0, 0x0110);
  const software = ascii(ifd0, 0x0131);
  const when = ascii(exif, 0x9003) ?? ascii(ifd0, 0x0132);
  const m = when && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(when);
  const capturedAt = m && m[1] !== "0000" ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`) : undefined;
  return {
    device: [make, model].filter(Boolean).join(" ") || undefined,
    software: software ? [software] : [],
    ...(capturedAt && !Number.isNaN(capturedAt.getTime()) ? { capturedAt } : {}),
    hasLocation: ifd0.has(0x8825) || undefined,
  };
}

// ---------------------------------------------------------------- MP4 / MOV

function readIsoMedia(b: Buffer): Meta {
  let meta: Meta = {};
  const walk = (start: number, end: number, depth: number) => {
    let p = start;
    while (p + 8 <= end && depth < 8) {
      let size = b.readUInt32BE(p);
      const type = b.toString("latin1", p + 4, p + 8);
      let header = 8;
      if (size === 1 && p + 16 <= end) {
        size = Number(b.readBigUInt64BE(p + 8));
        header = 16;
      } else if (size === 0) size = end - p;
      if (size < header || p + size > end) break;
      const body = p + header;
      if (["moov", "udta", "trak", "mdia", "meta", "ilst"].includes(type)) walk(type === "meta" && b.toString("latin1", body + 4, body + 8) !== "hdlr" ? body + 4 : body, p + size, depth + 1);
      if (type === "mvhd") {
        const version = b[body]!;
        const secs = version === 1 ? Number(b.readBigUInt64BE(body + 4)) : b.readUInt32BE(body + 4);
        const scale = version === 1 ? b.readUInt32BE(body + 20) : b.readUInt32BE(body + 12);
        const duration = version === 1 ? Number(b.readBigUInt64BE(body + 24)) : b.readUInt32BE(body + 16);
        // Segundos desde 1904; 0 = sin fecha.
        if (secs > 0) meta = merge(meta, { capturedAt: new Date((secs - 2_082_844_800) * 1000) });
        if (scale > 0) meta = merge(meta, { seconds: Math.round(duration / scale) });
      }
      if (type === "©too" || type === "©swr") meta = merge(meta, { software: [b.toString("utf8", body, p + size).replace(/^[\s\S]{0,16}data[\s\S]{8}/, "").replace(/[^\x20-\x7e]/g, "").trim()] });
      if (type === "©xyz") meta = merge(meta, { hasLocation: true });
      if (type === "©mak" || type === "©mod") meta = merge(meta, { device: b.toString("utf8", body, p + size).replace(/[^\x20-\x7e]/g, "").trim() || undefined });
      if (type === "uuid" || type === "jumb" || type === "c2pa") {
        const s = b.toString("latin1", body, Math.min(p + size, body + 4096));
        if (/c2pa|jumb/i.test(s)) meta = merge(meta, { contentCredentials: { present: true, generator: c2paGenerator(b.subarray(body, p + size)) } });
      }
      p += size;
    }
  };
  walk(0, b.length, 0);
  // Algunos celulares guardan la fecha y ubicación como claves de QuickTime (texto).
  const txt = b.toString("latin1", 0, Math.min(b.length, 4_000_000));
  if (/com\.apple\.quicktime\.location\.ISO6709/.test(txt)) meta = merge(meta, { hasLocation: true });
  return tidy(meta);
}

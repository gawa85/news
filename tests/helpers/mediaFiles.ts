/** Archivos de prueba REALES (JPEG, PNG, MP4) con datos internos a medida, para probar los lectores. */
import { crc32 } from "node:zlib";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

// ---------------------------------------------------------------- archivos de prueba (reales, no simulados)

export type Pattern = (x: number, y: number) => number;
export const gradient: Pattern = (x, y) => (x * 3 + y * 2) % 256;
export const blobs: Pattern = (x, y) => (Math.sin(x / 9) * Math.cos(y / 7) > 0 ? 220 : 30);

export function pixels(w: number, h: number, f: Pattern) {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = f((x * 256) / w, (y * 192) / h);
    data.set([v, 255 - v, (v * 2) % 256, 255], (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

export const makeJpeg = (w: number, h: number, f: Pattern, quality = 90, segments: Buffer[] = []) => {
  const raw = jpeg.encode(pixels(w, h, f), quality).data;
  return Buffer.concat([raw.subarray(0, 2), ...segments, raw.subarray(2)]);
};

export const segment = (marker: number, body: Buffer) => {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, body]);
};

/** EXIF mínimo (big-endian): programa, fecha de la toma y, si se pide, ubicación. */
export function exif(opts: { software?: string; taken?: string; gps?: boolean }): Buffer {
  const ascii = (s: string) => Buffer.from(`${s}\0`, "latin1");
  const ifd0: [number, number, Buffer | number][] = [];
  if (opts.software) ifd0.push([0x0131, 2, ascii(opts.software)]);
  ifd0.push([0x8769, 4, 0]); // puntero al IFD de EXIF (se completa abajo)
  if (opts.gps) ifd0.push([0x8825, 4, 0]);
  const exifIfd: [number, number, Buffer | number][] = opts.taken ? [[0x9003, 2, ascii(opts.taken)]] : [];
  const out = Buffer.alloc(1024);
  out.write("MM", 0, "latin1");
  out.writeUInt16BE(42, 2);
  out.writeUInt32BE(8, 4);
  let dataAt = 8 + 2 + ifd0.length * 12 + 4;
  const writeIfd = (at: number, entries: [number, number, Buffer | number][], ptr?: () => number) => {
    out.writeUInt16BE(entries.length, at);
    entries.forEach(([tag, type, value], i) => {
      const e = at + 2 + i * 12;
      out.writeUInt16BE(tag, e);
      out.writeUInt16BE(type, e + 2);
      if (typeof value === "number") {
        out.writeUInt32BE(1, e + 4);
        out.writeUInt32BE(tag === 0x8769 && ptr ? ptr() : at, e + 8);
      } else {
        out.writeUInt32BE(value.length, e + 4);
        if (value.length <= 4) value.copy(out, e + 8);
        else {
          value.copy(out, dataAt);
          out.writeUInt32BE(dataAt, e + 8);
          dataAt += value.length;
        }
      }
    });
  };
  let exifAt = 0;
  writeIfd(8, ifd0, () => exifAt);
  exifAt = dataAt + 16;
  dataAt = exifAt + 2 + exifIfd.length * 12 + 4;
  writeIfd(exifAt, exifIfd);
  writeIfd(8, ifd0, () => exifAt); // otra vez, ya con el puntero bien
  return segment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), out.subarray(0, dataAt + 8)]));
}

export const xmp = (inner: string) => segment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description ${inner}/></x:xmpmeta>`, "utf8"));

export function pngWithText(key: string, value: string): Buffer {
  const img = new PNG({ width: 64, height: 48 });
  img.data = pixels(64, 48, gradient).data;
  const raw = PNG.sync.write(img);
  const data = Buffer.from(`${key}\0${value}`, "latin1");
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write("tEXt", 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0);
  const iend = raw.length - 12;
  return Buffer.concat([raw.subarray(0, iend), head, data, crc, raw.subarray(iend)]);
}

/** MP4 mínimo: ftyp + moov/mvhd con fecha de creación y duración, y un programa (©too) opcional. */
export function mp4(created: Date, seconds: number, tool?: string): Buffer {
  const box = (type: string, body: Buffer) => {
    const h = Buffer.alloc(8);
    h.writeUInt32BE(body.length + 8);
    h.write(type, 4, "latin1");
    return Buffer.concat([h, body]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(Math.floor(created.getTime() / 1000) + 2_082_844_800, 4);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const udta = tool ? [box("udta", box("©too", Buffer.from(tool, "latin1")))] : [];
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0isom", "latin1")), box("moov", Buffer.concat([box("mvhd", mvhd), ...udta]))]);
}


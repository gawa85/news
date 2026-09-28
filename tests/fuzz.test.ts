/**
 * FUZZING de todo lo que lee datos que manda cualquiera: archivos (fotos, videos), JSON de los
 * webhooks y texto (feeds, HTML, capturas). Regla: nunca romperse, nunca colgarse, nunca tardar de más.
 * Semilla fija (se reproduce igual). Más vueltas: FUZZ_ITERATIONS=5000 npm test.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cleanScreenshotText } from "../src/domain/rules/screenshotText";
import { parseFeed } from "../src/infrastructure/content/RssSource";
import { htmlToText } from "../src/infrastructure/evidence/HttpPageCapturer";
import { htmlToText as mailHtmlToText } from "../src/infrastructure/mail/MailparserMimeParser";
import { LocalMediaInspector } from "../src/infrastructure/media/LocalMediaInspector";
import { TelegramUpdateParser, WhatsAppWebhookParser } from "../src/infrastructure/messaging/ChannelAdapters";
import { exif, gradient, makeJpeg, mp4, pngWithText, segment, xmp } from "./helpers/mediaFiles";

const N = Number(process.env.FUZZ_ITERATIONS ?? 300);

/** Generador con semilla (mulberry32): la misma secuencia en cada corrida. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  const pick = <T>(xs: T[]) => xs[int(xs.length)]!;
  return { next, int, pick };
}

type R = ReturnType<typeof rng>;

/** Una mutación de las que rompen lectores: bits, largos imposibles, recortes, repeticiones. */
function mutate(src: Buffer, r: R): Buffer {
  const b = Buffer.from(src);
  switch (r.int(7)) {
    case 0: // bits al azar
      for (let i = 0, n = 1 + r.int(20); i < n; i++) b[r.int(b.length)] ^= 1 << r.int(8);
      return b;
    case 1: // un "largo" de 16 bits imposible
      if (b.length > 4) b.writeUInt16BE(r.pick([0, 1, 2, 0xffff, 0x7fff]), r.int(b.length - 2));
      return b;
    case 2: // un "largo" de 32 bits imposible
      if (b.length > 8) b.writeUInt32BE(r.pick([0, 1, 7, 8, 16, 0xffffffff, 0x7fffffff]), r.int(b.length - 4));
      return b;
    case 3: // recortado
      return b.subarray(0, r.int(b.length));
    case 4: // un pedazo repetido muchas veces
      {
        const at = r.int(b.length);
        const piece = b.subarray(at, at + 1 + r.int(64));
        return Buffer.concat([b.subarray(0, at), ...Array(1 + r.int(50)).fill(piece), b.subarray(at)]);
      }
    case 5: // basura en el medio
      {
        const at = r.int(b.length);
        return Buffer.concat([b.subarray(0, at), Buffer.from(Array.from({ length: 1 + r.int(200) }, () => r.int(256))), b.subarray(at)]);
      }
    default: // cabecera buena y el resto al azar
      return Buffer.concat([b.subarray(0, 12), Buffer.from(Array.from({ length: r.int(4000) }, () => r.int(256)))]);
  }
}

async function timed<T>(what: string, fn: () => Promise<T> | T, maxMs: number): Promise<T> {
  const t0 = Date.now();
  const out = await fn();
  const ms = Date.now() - t0;
  assert.ok(ms < maxMs, `${what} tardó ${ms} ms`);
  return out;
}

function webp(): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, "latin1");
    h.writeUInt32LE(body.length, 4);
    return Buffer.concat([h, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), chunk("EXIF", exif({ software: "GIMP" }).subarray(4)), chunk("XMP ", Buffer.from("<x:xmpmeta/>"))]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

describe("Fuzzing: fotos y videos", () => {
  const inspector = new LocalMediaInspector();
  const seeds: [string, Buffer, string][] = [
    ["jpeg", makeJpeg(160, 120, gradient, 80, [exif({ software: "Photoshop", taken: "2019:05:01 10:30:00", gps: true }), xmp('xmp:CreatorTool="x" c2pa="1"'), segment(0xeb, Buffer.from("JPjumbc2pa claim_generator Firefly"))]), "image/jpeg"],
    ["png", pngWithText("parameters", "a photo, steps: 30"), "image/png"],
    ["mp4", mp4(new Date("2018-06-01T00:00:00Z"), 42, "Lavf58"), "video/mp4"],
    ["webp", webp(), "image/webp"],
  ];

  for (const [name, seed, mime] of seeds) {
    test(`${name}: ${N} archivos mutados no rompen ni cuelgan el lector`, async () => {
      const r = rng(name.length * 7919);
      for (let i = 0; i < N; i++) {
        const file = mutate(seed, r);
        const out = await timed(`${name} #${i}`, () => inspector.inspect(file, mime), 3_000);
        if (out) {
          assert.equal(out.bytes, file.length);
          assert.match(out.sha256, /^[0-9a-f]{64}$/);
          if (out.perceptualHash) assert.match(out.perceptualHash, /^[0-9a-f]{16}$/);
        }
      }
    });
  }

  test("bombas: un archivo chico que declara una imagen gigante no se decodifica", async () => {
    // PNG de 1 × 1 real, con la cabecera cambiada a 100.000 × 100.000 (40 GB en memoria si se decodificara).
    const png = pngWithText("Software", "x");
    png.writeUInt32BE(100_000, 16);
    png.writeUInt32BE(100_000, 20);
    const p = await timed("bomba PNG", () => inspector.inspect(png, "image/png"), 2_000);
    assert.equal(p?.perceptualHash, undefined);
    // JPEG que declara 65.535 × 65.535.
    const jpg = makeJpeg(32, 32, gradient);
    const sof = jpg.indexOf(Buffer.from([0xff, 0xc0]));
    jpg.writeUInt16BE(0xffff, sof + 5);
    jpg.writeUInt16BE(0xffff, sof + 7);
    const j = await timed("bomba JPEG", () => inspector.inspect(jpg, "image/jpeg"), 2_000);
    assert.equal(j?.perceptualHash, undefined);
    // MP4 con cajas anidadas muy profundo y un tamaño de 64 bits absurdo.
    let deep = Buffer.from("");
    for (let i = 0; i < 2000; i++) {
      const h = Buffer.alloc(8);
      h.writeUInt32BE(deep.length + 8);
      h.write("moov", 4, "latin1");
      deep = Buffer.concat([h, deep]);
    }
    const huge = Buffer.alloc(16);
    huge.writeUInt32BE(1);
    huge.write("mdat", 4, "latin1");
    huge.writeBigUInt64BE(2n ** 62n, 8);
    await timed("MP4 profundo", () => inspector.inspect(Buffer.concat([mp4(new Date(), 1).subarray(0, 24), deep, huge]), "video/mp4"), 2_000);
  });

  test("basura con la cabecera correcta de cada formato", async () => {
    const r = rng(42);
    const heads = [Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.from("RIFF\0\0\0\0WEBP", "latin1"), Buffer.from("\0\0\0\x18ftypisom", "latin1")];
    for (let i = 0; i < N; i++) {
      const file = Buffer.concat([r.pick(heads), Buffer.from(Array.from({ length: r.int(3000) }, () => r.int(256)))]);
      await timed(`basura #${i}`, () => inspector.inspect(file, r.pick(["image/jpeg", "image/png", "image/webp", "video/mp4"])), 2_000);
    }
  });
});

describe("Fuzzing: JSON de los webhooks", () => {
  /** Valores de todos los tipos, incluidos los que nadie espera. */
  function anyValue(r: R, depth = 0): unknown {
    switch (r.int(depth > 3 ? 6 : 9)) {
      case 0: return null;
      case 1: return r.int(2) === 0;
      case 2: return r.pick([0, -1, 1e308, NaN, 1790000000, 5491155550000]);
      case 3: return r.pick(["", "a", "text", "image", "video", "audio", "5491155550000", "x".repeat(10_000), "\u0000", "💥"]);
      case 4: return undefined;
      case 5: return [];
      case 6: return Array.from({ length: r.int(3) }, () => anyValue(r, depth + 1));
      default: {
        const keys = ["entry", "changes", "value", "messages", "contacts", "from", "id", "timestamp", "type", "text", "body", "image", "video", "audio", "caption", "mime_type", "context", "message", "chat", "photo", "document", "voice", "file_id", "date", "message_id", "forward_origin"];
        return Object.fromEntries(Array.from({ length: 1 + r.int(5) }, () => [r.pick(keys), anyValue(r, depth + 1)]));
      }
    }
  }
  /** Un mensaje válido con algún campo cambiado por cualquier cosa. */
  function corrupt(base: unknown, r: R): unknown {
    const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    const paths: Record<string, unknown>[] = [];
    const walk = (o: unknown) => {
      if (o && typeof o === "object") {
        paths.push(o as Record<string, unknown>);
        Object.values(o).forEach(walk);
      }
    };
    walk(copy);
    const target = r.pick(paths);
    const key = r.pick(Object.keys(target).length ? Object.keys(target) : ["x"]);
    target[key] = anyValue(r);
    return copy;
  }

  const waOk = { entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Leo" } }], messages: [{ from: "5491177777777", id: "wamid.A", timestamp: "1790000000", type: "image", image: { id: "i", mime_type: "image/jpeg", caption: "hola" } }] } }] }] };
  const tgOk = { message: { message_id: 1, date: 1790000000, chat: { id: 42 }, from: { first_name: "Ana" }, photo: [{ file_id: "P" }], caption: "hola" } };

  test(`WhatsApp y Telegram: ${N * 2} cuerpos raros devuelven un mensaje o nada, nunca un error`, () => {
    const r = rng(7);
    const wa = new WhatsAppWebhookParser();
    const tg = new TelegramUpdateParser();
    for (let i = 0; i < N; i++) {
      for (const [parser, base] of [[wa, waOk], [tg, tgOk]] as const) {
        const input = r.int(3) === 0 ? anyValue(r) : corrupt(base, r);
        let out: ReturnType<typeof parser.parse>;
        try {
          out = parser.parse(input);
        } catch (e) {
          assert.fail(`${parser.channel} se rompió con ${JSON.stringify(input)?.slice(0, 300)}: ${e}`);
        }
        if (out) {
          assert.equal(typeof out.from, "string");
          assert.equal(typeof out.text, "string");
          assert.ok(out.receivedAt instanceof Date);
        }
      }
    }
  });
});

describe("Fuzzing: texto (feeds, HTML, capturas)", () => {
  // Entradas pensadas para que una expresión regular tarde muchísimo (ReDoS).
  const nasty = [
    "<".repeat(50_000),
    "<a ".repeat(20_000),
    "<!--".repeat(20_000),
    "<script>".repeat(10_000),
    "&#".repeat(30_000),
    "<item><title>".repeat(10_000),
    "<![CDATA[".repeat(10_000),
    " ".repeat(100_000) + "x",
    "a".repeat(200_000),
    "1".repeat(100_000) + "%",
    "\n".repeat(50_000),
    "<p>" + "a ".repeat(50_000) + "</p>",
  ];

  test("entradas diseñadas para trabar expresiones regulares terminan rápido", async () => {
    for (const s of nasty) {
      await timed(`htmlToText(${s.slice(0, 12)}…)`, () => htmlToText(s), 1_000);
      await timed(`mail(${s.slice(0, 12)}…)`, () => mailHtmlToText(s), 1_000);
      await timed(`parseFeed(${s.slice(0, 12)}…)`, () => parseFeed(s), 1_000);
      await timed(`captura(${s.slice(0, 12)}…)`, () => cleanScreenshotText(s), 1_000);
    }
  });

  test(`${N} feeds y páginas mutadas no rompen los lectores`, async () => {
    const r = rng(99);
    const feed = Buffer.from(`<?xml version="1.0"?><rss><channel><item><title>Nota &amp; más</title><link>https://a.example/1</link><pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Hola <b>mundo</b></p>]]></description></item><entry><title>Atom</title><link href="https://a.example/2"/><updated>2026-09-21T10:00:00Z</updated></entry></channel></rss>`);
    const page = Buffer.from(`<html><head><title>T</title><style>x{}</style></head><body><p>Uno &nbsp; &#8220;dos&#8221;</p><script>var a="<p>";</script><!-- c --></body></html>`);
    for (let i = 0; i < N; i++) {
      const f = mutate(feed, r).toString("utf8");
      const p = mutate(page, r).toString("utf8");
      const items = await timed("feed", () => parseFeed(f), 1_000);
      assert.ok(Array.isArray(items));
      await timed("página", () => htmlToText(p), 1_000);
      await timed("captura", () => cleanScreenshotText(p), 1_000);
    }
  });
});

/** Fotos y videos: datos internos, marca de IA, huella perceptual y "¿ya circuló?", sin servicios externos. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hammingDistance, hashBands, mediaReport } from "../src/domain/rules/mediaForensics";
import { FakeMediaFetcher } from "../src/infrastructure/inclusion/SpeechAdapters";
import { TelegramUpdateParser, WhatsAppWebhookParser } from "../src/infrastructure/messaging/ChannelAdapters";
import { LocalMediaInspector } from "../src/infrastructure/media/LocalMediaInspector";
import type { AddressInfo } from "node:net";
import { httpApiDeps } from "../src/composition/platform";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { testPlatform, userWithPlan, wa } from "./helpers/platform";
import { blobs, exif, gradient, makeJpeg, mp4, pngWithText, xmp } from "./helpers/mediaFiles";

const inspector = new LocalMediaInspector();
const NOW = new Date("2026-09-28T12:00:00Z");

describe("Imágenes y videos: reglas", () => {
  test("distancia entre huellas y partes para buscar parecidas", () => {
    assert.equal(hammingDistance("0000000000000000", "0000000000000000"), 0);
    assert.equal(hammingDistance("ffffffffffffffff", "0000000000000000"), 64);
    assert.equal(hammingDistance("0f00000000000001", "0000000000000000"), 5);
    assert.deepEqual(hashBands("0123456789abcdef"), ["0:01", "1:23", "2:45", "3:67", "4:89", "5:ab", "6:cd", "7:ef"]);
  });

  test("sin datos no se concluye nada; en WhatsApp se explica que los borra", () => {
    const r = mediaReport({ kind: "image", mime: "image/jpeg", bytes: 10, sha256: "x" }, NOW, undefined, "whatsapp");
    assert.deepEqual(r.signals.map((s) => s.id), ["no_metadata"]);
    assert.match(r.signals[0]!.detail, /WhatsApp borra/);
    assert.match(r.summary, /no garantiza que sea auténtico/);
  });
});

describe("Imágenes y videos: lectura del archivo", () => {
  test("JPEG: programa de edición, fecha de la toma y ubicación (sin decir cuál)", async () => {
    const file = makeJpeg(200, 150, gradient, 90, [exif({ software: "Adobe Photoshop 25.0", taken: "2019:05:01 10:30:00", gps: true })]);
    const i = (await inspector.inspect(file, "image/jpeg"))!;
    assert.equal(i.kind, "image");
    assert.deepEqual([i.width, i.height], [200, 150]);
    assert.deepEqual(i.software, ["Adobe Photoshop 25.0"]);
    assert.equal(i.capturedAt?.getFullYear(), 2019);
    assert.equal(i.hasLocation, true);
    const ids = mediaReport(i, NOW).signals.map((s) => s.id);
    assert.deepEqual(ids, ["old_capture", "edited", "location"]);
  });

  test("marca de IA: estándar IPTC en XMP y parámetros de un generador en PNG", async () => {
    const tagged = await inspector.inspect(makeJpeg(120, 90, blobs, 90, [xmp('Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"')]), "image/jpeg");
    assert.ok(tagged?.aiMarkers?.length);
    const sd = await inspector.inspect(pngWithText("parameters", "a photo of a protest, steps: 30, sampler: euler"), "image/png");
    assert.ok(sd?.aiMarkers?.length);
    assert.ok(sd?.perceptualHash, "el PNG se decodifica igual");
    assert.equal(mediaReport(sd!, NOW).signals[0]!.id, "ai_generated");
    const tool = await inspector.inspect(makeJpeg(120, 90, blobs, 90, [xmp('xmp:CreatorTool="Adobe Firefly"')]), "image/jpeg");
    assert.ok(mediaReport(tool!, NOW).signals.some((s) => s.id === "ai_generated"));
  });

  test("huella perceptual: la misma foto achicada y recomprimida da casi igual; otra foto, distinta", async () => {
    const a = (await inspector.inspect(makeJpeg(640, 480, gradient, 92), "image/jpeg"))!.perceptualHash!;
    const b = (await inspector.inspect(makeJpeg(320, 240, gradient, 55), "image/jpeg"))!.perceptualHash!;
    const c = (await inspector.inspect(makeJpeg(640, 480, blobs, 92), "image/jpeg"))!.perceptualHash!;
    assert.ok(hammingDistance(a, b) <= 6, `parecidas: ${hammingDistance(a, b)}`);
    assert.ok(hammingDistance(a, c) > 16, `distintas: ${hammingDistance(a, c)}`);
  });

  test("video MP4: fecha de creación, duración y re-edición", async () => {
    const v = (await inspector.inspect(mp4(new Date("2018-06-01T00:00:00Z"), 42, "Lavf58.76.100"), "video/mp4"))!;
    assert.equal(v.kind, "video");
    assert.equal(v.capturedAt?.toISOString().slice(0, 10), "2018-06-01");
    assert.equal(v.seconds, 42);
    assert.deepEqual(mediaReport(v, NOW).signals.map((s) => s.id), ["old_capture", "reencoded"]);
  });

  test("WhatsApp y Telegram: los videos ya no se descartan", () => {
    const w = new WhatsAppWebhookParser().parse({ entry: [{ changes: [{ value: { messages: [{ from: "5491155550000", id: "wamid.V", timestamp: "1790000000", type: "video", video: { id: "vid-1", mime_type: "video/mp4", caption: "mirá esto" } }] } }] }] });
    assert.deepEqual([w?.video, w?.text], [{ ref: "vid-1", mime: "video/mp4" }, "mirá esto"]);
    const tg = new TelegramUpdateParser().parse({ message: { message_id: 1, date: 1790000000, chat: { id: 42 }, video: { file_id: "V1", mime_type: "video/mp4", duration: 12 } } });
    assert.deepEqual(tg?.video, { ref: "V1", mime: "video/mp4", seconds: 12 });
  });

  test("formato desconocido: no se inventa nada", async () => {
    assert.equal(await inspector.inspect(Buffer.from("%PDF-1.7"), "application/pdf"), undefined);
  });
});

describe("Imágenes y videos: ¿ya circuló?", () => {
  test("la misma foto recomprimida días después se reconoce; sin guardar la imagen ni quién la mandó", async () => {
    const t = await testPlatform();
    const first = await t.p.mediaCheck.check({ data: makeJpeg(640, 480, gradient, 92), mime: "image/jpeg" });
    assert.ok(!first.signals.some((s) => s.id === "seen_before"));
    t.clock.advance(3 * 86_400_000);
    const again = await t.p.mediaCheck.check({ data: makeJpeg(320, 240, gradient, 60), mime: "image/jpeg" }, { channel: "whatsapp" });
    const seen = again.signals.find((s) => s.id === "seen_before");
    assert.ok(seen, "reconoce la recomprimida");
    assert.match(seen.detail, /o una casi igual/);
    const other = await t.p.mediaCheck.check({ data: makeJpeg(640, 480, blobs, 92), mime: "image/jpeg" });
    assert.ok(!other.signals.some((s) => s.id === "seen_before"), "otra foto no");

    const stored = await t.store.repos.mediaFingerprints.get(first.inspection.sha256);
    assert.deepEqual(Object.keys(stored!).sort(), ["firstSeenAt", "id", "kind", "lastSeenAt", "perceptualHash", "times"]);
  });

  test("en el chat: una foto sin texto recibe la revisión; un video, también", async () => {
    const media = new FakeMediaFetcher("whatsapp");
    const t = await testPlatform({ extra: { mediaFetchers: [media] } });
    media.files.set("foto-1", { data: makeJpeg(400, 300, gradient, 85, [exif({ taken: "2020:03:01 09:00:00" })]), mime: "image/jpeg" });
    const r = await t.p.inbound.execute(wa("+5491166660001", "", t.clock.now(), { image: { ref: "foto-1", mime: "image/jpeg" } }));
    const section = r.response.sections.find((s) => s.heading === "🔎 Sobre la imagen");
    assert.ok(section, JSON.stringify(r.response));
    assert.ok(section.lines.some((l) => /Es del 01\/03\/2020/.test(l)));

    media.files.set("video-1", { data: mp4(new Date("2021-01-10T00:00:00Z"), 15), mime: "video/mp4" });
    t.clock.advance(2 * 86_400_000);
    const v = await t.p.inbound.execute(wa("+5491166660001", "¿Esto pasó hoy en Rosario?", t.clock.now(), { video: { ref: "video-1", mime: "video/mp4" } }));
    assert.ok(v.response.sections.some((s) => s.heading === "🔎 Sobre el video" && s.lines.some((l) => /Es del 10\/01\/2021/.test(l))), JSON.stringify(v.response));
  });
});

describe("Imágenes y videos: por la API", () => {
  test("se sube el archivo tal cual (más de 1 MB) y vuelve la revisión; lo que no es imagen ni video se rechaza", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "profesional");
    const { plaintext } = await t.p.integrations.apiKeys.create({ actorId: u.id, name: "prueba", scopes: ["content:analyze"] });
    const server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const big = makeJpeg(1600, 1200, gradient, 100, [exif({ software: "GIMP 2.10", taken: "2015:01:01 12:00:00" })]);
      assert.ok(big.length > 1_000_000, `el archivo pesa ${big.length}`);
      const r = await fetch(`${base}/v1/media/check`, { method: "POST", headers: { authorization: `Bearer ${plaintext}`, "content-type": "image/jpeg" }, body: big });
      assert.equal(r.status, 200);
      const body = (await r.json()) as { kind: string; signals: { id: string }[]; file: { width: number; software: string[] } };
      assert.equal(body.kind, "image");
      assert.deepEqual(body.signals.map((x) => x.id), ["old_capture", "edited"]);
      assert.deepEqual([body.file.width, body.file.software], [1600, ["GIMP 2.10"]]);
      const pdf = await fetch(`${base}/v1/media/check`, { method: "POST", headers: { authorization: `Bearer ${plaintext}`, "content-type": "application/pdf" }, body: "%PDF" });
      assert.equal(pdf.status, 400);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

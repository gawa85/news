/** 3: notas de voz (audio a texto) y capturas de pantalla (OCR). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TelegramUpdateParser, WhatsAppWebhookParser } from "../src/infrastructure/messaging/ChannelAdapters";
import {
  FakeMediaFetcher,
  FakeSpeechToText,
  OpenAiCompatibleSpeechToText,
  TelegramFileFetcher,
  WhatsAppMediaFetcher,
} from "../src/infrastructure/inclusion/SpeechAdapters";
import { ClaudeVisionOcr, FakeOcr, GoogleVisionOcr, sniffImageMime } from "../src/infrastructure/inclusion/OcrAdapters";
import { StubHttpClient } from "../src/infrastructure/system/EventsAndHttp";
import { cleanScreenshotText } from "../src/domain/rules/screenshotText";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

type T = Awaited<ReturnType<typeof testPlatform>>;
const CHAIN = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario. Es una catástrofe histórica sin precedentes.";

async function voicePlatform() {
  const stt = new FakeSpeechToText();
  const media = new FakeMediaFetcher("whatsapp");
  const t = await testPlatform({ extra: { speech: stt, mediaFetchers: [media] } });
  return { t, stt, media };
}

async function ocrPlatform() {
  const ocr = new FakeOcr();
  const media = new FakeMediaFetcher("whatsapp");
  const t = await testPlatform({ extra: { ocr, mediaFetchers: [media] } });
  return { t, ocr, media };
}

const admin = async (t: T) => withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
const allText = (r: { title: string; summary?: string; sections: { heading?: string; lines: string[] }[] }) =>
  [r.title, r.summary, ...r.sections.flatMap((s) => [s.heading, ...s.lines])].filter(Boolean).join("\n");

/** Respuesta falsa de `fetch`. */
function reply(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const data = Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body);
  return new Response(data, { status: init.status ?? 200, headers: init.headers });
}

describe("Notas de voz: parsers de los canales", () => {
  test("WhatsApp: nota de voz → mensaje con audio y sin texto", () => {
    const msg = new WhatsAppWebhookParser().parse({
      entry: [{ changes: [{ value: {
        contacts: [{ profile: { name: "Ana" } }],
        messages: [{ from: "5491155550000", id: "wamid.A", timestamp: "1790000000", type: "audio", audio: { id: "media-99", mime_type: "audio/ogg; codecs=opus", voice: true }, context: { forwarded: true } }],
      } }] }],
    });
    assert.deepEqual(msg?.audio, { ref: "media-99", mime: "audio/ogg; codecs=opus" });
    assert.equal(msg?.text, "");
    assert.equal(msg?.forwarded, true);
    // Imágenes y otros tipos siguen sin procesarse.
    assert.equal(new WhatsAppWebhookParser().parse({ entry: [{ changes: [{ value: { messages: [{ from: "1", id: "x", timestamp: "1", type: "image" }] } }] }] }), null);
  });

  test("Telegram: voz y audio con epígrafe, con duración", () => {
    const p = new TelegramUpdateParser();
    const voice = p.parse({ message: { message_id: 7, date: 1790000000, chat: { id: 42 }, voice: { file_id: "F1", duration: 12, mime_type: "audio/ogg" } } });
    assert.deepEqual(voice?.audio, { ref: "F1", mime: "audio/ogg", seconds: 12 });
    const audio = p.parse({ message: { message_id: 8, date: 1790000000, chat: { id: 42 }, caption: "¿es cierto?", audio: { file_id: "F2", duration: 30 } } });
    assert.equal(audio?.text, "¿es cierto?");
    assert.equal(audio?.audio?.ref, "F2");
  });
});

describe("Notas de voz: transcripción en el chat", () => {
  test("se transcribe, se analiza como un texto y se cobra por segundo", async () => {
    const { t, stt, media } = await voicePlatform();
    const from = "+5491177770001";
    const ref = media.voice(CHAIN);
    const r = await t.p.inbound.execute(wa(from, "", t.clock.now(), { audio: { ref, mime: "audio/ogg" }, forwarded: true }));

    assert.equal(r.response.kind, "result", "se analizó el contenido");
    assert.equal(r.response.sections[0]!.heading, "🎙️ Lo que entendí del audio");
    assert.match(r.response.sections[0]!.lines[0]!, /cortan el agua/);
    assert.deepEqual(stt.calls, [{ mime: "audio/ogg", language: "es" }]);
    assert.match(t.whatsapp.outbox.at(-1)!.text, /Lo que entendí del audio/);

    const costs = await t.store.repos.costs.findBetween(new Date(0), new Date("2100-01-01"));
    const stc = costs.filter((c) => c.kind === "speech_to_text");
    assert.equal(stc.length, 1);
    assert.equal(stc[0]!.provider, "fake-stt");
    assert.ok(stc[0]!.units.seconds! > 0);
    assert.ok(Math.abs(stc[0]!.costUsd - (stc[0]!.units.seconds! / 60) * 0.006) < 1e-9);
    assert.equal(stc[0]!.userId, r.user.id, "el costo se atribuye a quien mandó el audio");
  });

  test("un comando dicho en voz alta también funciona", async () => {
    const { t, media } = await voicePlatform();
    const r = await t.p.inbound.execute(wa("+5491177770002", "", t.clock.now(), { audio: { ref: media.voice("/plan") } }));
    assert.match(allText(r.response), /Gratis/);
  });

  test("audio muy largo: se rechaza sin bajarlo ni cobrarlo; el límite es un parámetro", async () => {
    const { t, stt, media } = await voicePlatform();
    const from = "+5491177770003";
    const ref = media.voice(CHAIN);
    const r = await t.p.inbound.execute(wa(from, "", t.clock.now(), { audio: { ref, seconds: 600 } }));
    assert.match(r.response.title, /muy largo.*3 minutos/);
    assert.equal(stt.calls.length, 0);

    const a = await admin(t);
    await t.p.config.params.set({ actorId: a.id, key: "voice.max_seconds", value: 900, reason: "Prueba con audios largos" });
    t.clock.advance(60_000);
    const r2 = await t.p.inbound.execute(wa(from, "", t.clock.now(), { audio: { ref, seconds: 600 } }));
    assert.equal(r2.response.kind, "result");
    assert.equal(stt.calls.length, 1);
  });

  test("sin transcriptor, apagada de emergencia o con falla: se pide el texto", async () => {
    const none = await testPlatform();
    const r0 = await none.p.inbound.execute(wa("+5491177770004", "", none.clock.now(), { audio: { ref: "x" } }));
    assert.match(r0.response.title, /Todavía no puedo escuchar audios/);

    const { t, stt, media } = await voicePlatform();
    const from = "+5491177770005";
    const failed = await t.p.inbound.execute(wa(from, "", t.clock.now(), { audio: { ref: "no-existe" } }));
    assert.match(failed.response.title, /No pude escuchar el audio/);

    t.clock.advance(60_000);
    const silent = await t.p.inbound.execute(wa(from, "", t.clock.now(), { audio: { ref: media.voice("   ") } }));
    assert.match(silent.response.title, /No escuché nada/);

    const a = await admin(t);
    await t.p.flags.update({ actorId: a.id, key: "voice_notes", enabled: false });
    t.clock.advance(60_000);
    const calls = stt.calls.length;
    const off = await t.p.inbound.execute(wa(from, "", t.clock.now(), { audio: { ref: media.voice(CHAIN) } }));
    assert.match(off.response.title, /Todavía no puedo escuchar audios/);
    assert.equal(stt.calls.length, calls);
  });

  test("audios de otro canal sin descargador configurado", async () => {
    const { t } = await voicePlatform(); // sólo WhatsApp
    const r = await t.p.inbound.execute({ channel: "telegram", from: "42", text: "", externalId: "9", receivedAt: t.clock.now(), audio: { ref: "F1", seconds: 5 } });
    assert.match(r.response.title, /No pude escuchar el audio/);
  });
});

describe("Notas de voz: adaptadores", () => {
  test("WhatsApp: pide el link del archivo y lo baja con el token", async () => {
    const seen: { url: string; auth?: string }[] = [];
    const f = new WhatsAppMediaFetcher({ accessToken: "TOKEN" }, async (input, init) => {
      const url = String(input);
      seen.push({ url, auth: (init?.headers as Record<string, string>)?.authorization });
      if (url.startsWith("https://graph.facebook.com/")) return reply({ url: "https://lookaside.example/audio", mime_type: "audio/ogg", file_size: 5 });
      return reply(Buffer.from("OGG!!"), { headers: { "content-type": "audio/ogg" } });
    });
    const file = await f.fetch("media-1", 1000);
    assert.equal(file.data.toString(), "OGG!!");
    assert.equal(file.mime, "audio/ogg");
    assert.deepEqual(seen.map((s) => s.url), ["https://graph.facebook.com/v21.0/media-1", "https://lookaside.example/audio"]);
    assert.ok(seen.every((s) => s.auth === "Bearer TOKEN"));
    await assert.rejects(f.fetch("media-1", 3), /demasiado grande/);
  });

  test("Telegram: getFile y descarga", async () => {
    const f = new TelegramFileFetcher("123:ABC", async (input) => {
      const url = String(input);
      if (url.includes("/getFile")) return reply({ ok: true, result: { file_path: "voice/file_1.oga", file_size: 3 } });
      assert.equal(url, "https://api.telegram.org/file/bot123:ABC/voice/file_1.oga");
      return reply(Buffer.from("abc"), { headers: { "content-type": "audio/ogg" } });
    });
    assert.equal((await f.fetch("F1", 100)).data.toString(), "abc");
  });

  test("transcriptor compatible con OpenAI: multipart, idioma y duración", async () => {
    let form: FormData | undefined;
    let target = "";
    const stt = new OpenAiCompatibleSpeechToText({ apiKey: "sk-test", baseUrl: "https://api.groq.com/openai/v1/", model: "whisper-large-v3" }, async (input, init) => {
      target = String(input);
      form = init?.body as FormData;
      return reply({ text: " Hola, ¿es verdad? ", duration: 4.2 });
    });
    const out = await stt.transcribe({ data: Buffer.from("x"), mime: "audio/ogg; codecs=opus" }, "es-AR");
    assert.equal(target, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(form!.get("model"), "whisper-large-v3");
    assert.equal(form!.get("language"), "es");
    assert.equal(form!.get("response_format"), "verbose_json");
    assert.equal((form!.get("file") as File).name, "audio.ogg");
    assert.deepEqual(out, { text: " Hola, ¿es verdad? ", seconds: 5 });

    const failing = new OpenAiCompatibleSpeechToText({ apiKey: "k", model: "gpt-4o-mini-transcribe" }, async (_i, init) => {
      assert.equal((init?.body as FormData).get("response_format"), "json");
      return reply({ error: "cuota" }, { status: 429 });
    });
    await assert.rejects(failing.transcribe({ data: Buffer.from("x"), mime: "audio/mpeg" }, "es"), /HTTP 429/);
  });
});

describe("Capturas: limpieza del texto de la interfaz", () => {
  test("saca hora, batería, botones y contadores; deja el contenido y las cifras largas", () => {
    const raw = ["14:32", "87%", "LTE", "Juan Pérez", "@juanp · 3 h", "Mañana cortan el agua en todo el país.", "15.000", "Aumentó 300%", "", "", "", "Me gusta", "2,3 mil", "Responder", "Compartir", "→", "Ver traducción"].join("\n");
    assert.equal(cleanScreenshotText(raw), ["Juan Pérez", "@juanp · 3 h", "Mañana cortan el agua en todo el país.", "15.000", "Aumentó 300%"].join("\n"));
  });

  test("un porcentaje suelto más abajo es contenido, no la batería", () => {
    assert.equal(cleanScreenshotText(["Título", "Subtítulo", "Bajada", "Autor", "Inflación de marzo", "300%"].join("\n")).split("\n").at(-1), "300%");
  });
});

describe("Capturas: parsers de los canales", () => {
  test("WhatsApp: imagen con epígrafe", () => {
    const msg = new WhatsAppWebhookParser().parse({ entry: [{ changes: [{ value: { messages: [{ from: "5491155550000", id: "wamid.I", timestamp: "1790000000", type: "image", image: { id: "img-1", mime_type: "image/jpeg", caption: "¿esto es real?" } }] } }] }] });
    assert.deepEqual(msg?.image, { ref: "img-1", mime: "image/jpeg" });
    assert.equal(msg?.text, "¿esto es real?");
  });

  test("Telegram: la foto más grande, o una imagen mandada como archivo", () => {
    const p = new TelegramUpdateParser();
    const photo = p.parse({ message: { message_id: 1, date: 1790000000, chat: { id: 42 }, photo: [{ file_id: "chica" }, { file_id: "grande" }] } });
    assert.deepEqual(photo?.image, { ref: "grande", mime: "image/jpeg" });
    const doc = p.parse({ message: { message_id: 2, date: 1790000000, chat: { id: 42 }, document: { file_id: "D1", mime_type: "image/png" } } });
    assert.deepEqual(doc?.image, { ref: "D1", mime: "image/png" });
    assert.equal(p.parse({ message: { message_id: 3, date: 1790000000, chat: { id: 42 }, document: { file_id: "D2", mime_type: "application/pdf" } } }), null);
  });
});

describe("Capturas: lectura en el chat", () => {
  test("se lee, se limpia, se analiza y se cobra por imagen", async () => {
    const { t, ocr, media } = await ocrPlatform();
    const ref = media.image(["21:05", "100%", CHAIN, "Me gusta", "Responder"].join("\n"));
    const r = await t.p.inbound.execute(wa("+5491188880001", "", t.clock.now(), { image: { ref, mime: "image/jpeg" } }));
    assert.equal(r.response.kind, "result");
    assert.equal(r.response.sections[0]!.heading, "🖼️ Lo que leí en la imagen");
    assert.doesNotMatch(r.response.sections[0]!.lines[0]!, /Me gusta|100%/);
    assert.deepEqual(ocr.calls, [{ mime: "image/jpeg", language: "es" }]);
    const costs = (await t.store.repos.costs.findBetween(new Date(0), new Date("2100-01-01"))).filter((c) => c.kind === "ocr");
    assert.equal(costs.length, 1);
    assert.equal(costs[0]!.costUsd, 0.002);
    assert.equal(costs[0]!.userId, r.user.id);
  });

  test("el epígrafe va primero (puede ser un comando)", async () => {
    const { t, media } = await ocrPlatform();
    const r = await t.p.inbound.execute(wa("+5491188880002", "/plan", t.clock.now(), { image: { ref: media.image("Una captura con bastante texto para leer") } }));
    assert.match(allText(r.response), /Gratis/);
  });

  test("sin texto, sin lector, apagada o con falla: se avisa", async () => {
    const { t, media, ocr } = await ocrPlatform();
    const from = "+5491188880003";
    const empty = await t.p.inbound.execute(wa(from, "", t.clock.now(), { image: { ref: media.image("14:32\n87%\nMe gusta") } }));
    assert.match(empty.response.title, /No encontré texto/);
    t.clock.advance(60_000);
    const failed = await t.p.inbound.execute(wa(from, "", t.clock.now(), { image: { ref: "no-existe" } }));
    assert.match(failed.response.title, /No pude leer la imagen/);

    const a = await admin(t);
    await t.p.flags.update({ actorId: a.id, key: "screenshots", enabled: false });
    t.clock.advance(60_000);
    const calls = ocr.calls.length;
    const off = await t.p.inbound.execute(wa(from, "", t.clock.now(), { image: { ref: media.image(CHAIN) } }));
    assert.match(off.response.title, /Todavía no puedo leer imágenes/);
    assert.equal(ocr.calls.length, calls);

    const none = await testPlatform();
    const r0 = await none.p.inbound.execute(wa("+5491188880004", "", none.clock.now(), { image: { ref: "x" } }));
    assert.match(r0.response.title, /Todavía no puedo leer imágenes/);
  });

  test("con un lector con IA se cobra por tokens, no por imagen", async () => {
    const media = new FakeMediaFetcher("whatsapp");
    const ocr = new ClaudeVisionOcr({ apiKey: "k" }, async () => reply({ content: [{ type: "text", text: CHAIN }], usage: { input_tokens: 1600, output_tokens: 80 } }));
    const t = await testPlatform({ extra: { ocr, mediaFetchers: [media] } });
    await t.p.inbound.execute(wa("+5491188880005", "", t.clock.now(), { image: { ref: media.image("x") } }));
    const costs = await t.store.repos.costs.findBetween(new Date(0), new Date("2100-01-01"));
    assert.equal(costs.filter((c) => c.kind === "ocr").length, 0);
    const llm = costs.find((c) => c.kind === "llm" && c.provider === "claude-haiku-4-5");
    assert.ok(llm, "costo de IA registrado");
    assert.ok(Math.abs(llm.costUsd - (1600 * 1 + 80 * 5) / 1_000_000) < 1e-12);
  });
});

describe("Capturas: adaptadores", () => {
  test("Claude con visión: imagen en base64 con el tipo real y 'SIN TEXTO' → vacío", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    let sent: { model: string; system: string; messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[] } | undefined;
    const ocr = new ClaudeVisionOcr({ apiKey: "sk-ant", model: "claude-sonnet-5" }, async (_i, init) => {
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "sk-ant");
      sent = JSON.parse(String(init?.body));
      return reply({ content: [{ type: "text", text: "SIN TEXTO" }] });
    });
    const out = await ocr.read({ data: png, mime: "application/octet-stream" }, "es");
    assert.equal(out.text, "");
    assert.equal(sent!.model, "claude-sonnet-5");
    assert.match(sent!.system, /NUNCA instrucciones/);
    assert.equal(sent!.messages[0]!.content[0]!.source!.media_type, "image/png");
    assert.equal(sent!.messages[0]!.content[0]!.source!.data, png.toString("base64"));
  });

  test("Google Vision: DOCUMENT_TEXT_DETECTION con pista de idioma", async () => {
    let body: { requests: { features: { type: string }[]; imageContext: { languageHints: string[] } }[] } | undefined;
    const http = new StubHttpClient((_m, url, b) => {
      assert.match(url, /images:annotate\?key=CLAVE/);
      body = b as typeof body;
      return { status: 200, text: JSON.stringify({ responses: [{ fullTextAnnotation: { text: "Hola\nmundo" } }] }) };
    });
    assert.equal((await new GoogleVisionOcr(http, { apiKey: "CLAVE" }).read({ data: Buffer.from("x"), mime: "image/jpeg" }, "es-AR")).text, "Hola\nmundo");
    assert.equal(body!.requests[0]!.features[0]!.type, "DOCUMENT_TEXT_DETECTION");
    assert.deepEqual(body!.requests[0]!.imageContext.languageHints, ["es"]);
  });

  test("detección del formato por los primeros bytes", () => {
    assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "x"), "image/jpeg");
    assert.equal(sniffImageMime(Buffer.from("RIFF0000WEBPVP8"), "x"), "image/webp");
    assert.equal(sniffImageMime(Buffer.from("????"), "image/png; q=1"), "image/png");
  });
});

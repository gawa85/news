/** 3: notas de voz (audio a texto). */
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
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

type T = Awaited<ReturnType<typeof testPlatform>>;
const CHAIN = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario. Es una catástrofe histórica sin precedentes.";

async function voicePlatform() {
  const stt = new FakeSpeechToText();
  const media = new FakeMediaFetcher("whatsapp");
  const t = await testPlatform({ extra: { speech: { stt, fetchers: [media] } } });
  return { t, stt, media };
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

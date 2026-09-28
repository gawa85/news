/** Transcripción y lectura de capturas LOCALES (whisper.cpp, Tesseract): sin servicios externos ni costo por uso. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TesseractOcr } from "../src/infrastructure/inclusion/OcrAdapters";
import { FakeMediaFetcher, OpenAiCompatibleSpeechToText } from "../src/infrastructure/inclusion/SpeechAdapters";
import { testPlatform, wa } from "./helpers/platform";

const CHAIN = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario.";

describe("OCR local (Tesseract)", () => {
  test("la imagen entra por stdin (no se escribe a disco), con el idioma de la persona y tiempo límite", async () => {
    const calls: { cmd: string; args: string[]; bytes: number; timeout: number }[] = [];
    const ocr = new TesseractOcr({ timeoutMs: 5_000 }, async (cmd, args, input, timeout) => {
      calls.push({ cmd, args, bytes: input.length, timeout });
      return "texto leído";
    });
    assert.deepEqual(await ocr.read({ data: Buffer.from("PNG..."), mime: "image/png" }, "pt-BR"), { text: "texto leído" });
    assert.deepEqual(calls[0], { cmd: "tesseract", args: ["stdin", "stdout", "-l", "por+eng", "--psm", "3"], bytes: 6, timeout: 5_000 });
    await ocr.read({ data: Buffer.from("x"), mime: "image/png" }, "es");
    assert.equal(calls[1]!.args[3], "spa+eng");
  });

  test("en el chat: la captura se lee y el uso se cuenta con costo 0", async () => {
    const media = new FakeMediaFetcher("whatsapp");
    const ocr = new TesseractOcr({}, async () => `21:05\n${CHAIN}\nMe gusta`);
    const t = await testPlatform({ extra: { ocr, mediaFetchers: [media] } });
    const r = await t.p.inbound.execute(wa("+5491133330001", "", t.clock.now(), { image: { ref: media.image("x"), mime: "image/png" } }));
    assert.equal(r.response.sections[0]!.heading, "🖼️ Lo que leí en la imagen");
    const costs = (await t.store.repos.costs.findBetween(new Date(0), new Date("2100-01-01"))).filter((c) => c.kind === "ocr");
    assert.deepEqual(costs.map((c) => [c.provider, c.costUsd]), [["tesseract", 0]]);
  });
});

describe("Transcripción local (whisper.cpp)", () => {
  test("misma API que OpenAI; el uso se cuenta con costo 0", async () => {
    const requests: string[] = [];
    const speech = new OpenAiCompatibleSpeechToText({ id: "local-whisper", apiKey: "local", baseUrl: "http://whisper:8080/v1", model: "whisper-1" }, async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ text: CHAIN, duration: 7.2 }), { headers: { "content-type": "application/json" } });
    });
    const media = new FakeMediaFetcher("whatsapp");
    const t = await testPlatform({ extra: { speech, mediaFetchers: [media] } });
    const r = await t.p.inbound.execute(wa("+5491133330002", "", t.clock.now(), { audio: { ref: media.voice("x"), mime: "audio/ogg" } }));
    assert.equal(r.response.sections[0]!.heading, "🎙️ Lo que entendí del audio");
    assert.deepEqual(requests, ["http://whisper:8080/v1/audio/transcriptions"]);
    const costs = (await t.store.repos.costs.findBetween(new Date(0), new Date("2100-01-01"))).filter((c) => c.kind === "speech_to_text");
    assert.deepEqual(costs.map((c) => [c.provider, c.costUsd]), [["local-whisper", 0]]);
  });
});

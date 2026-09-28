/** 3.6 y 3.10: traducción y varios idiomas. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MultilingualCommandParser, ResponseLocalizer, TranslatingClaimExtractor, TranslatingSmokeDetector } from "../src/application/language/Translation";
import { SEED_EVALUATION_SET } from "../src/config/evaluationSet";
import type { Article, Claim, ResponseContent, SmokeAnalysis } from "../src/domain/model";
import type { ITranslator } from "../src/domain/ports";
import { detectLanguage } from "../src/domain/rules/language";
import { CachedTranslator, DeepLTranslator, FakeTranslator, GoogleTranslator, LLMTranslator, MeteredTranslator, StopwordLanguageDetector } from "../src/infrastructure/language/LanguageAdapters";
import { SpanishCommandParser } from "../src/infrastructure/messaging/SpanishCommandParser";
import { MemoryTtlCache } from "../src/infrastructure/observability/Observability";
import { StubHttpClient } from "../src/infrastructure/system/EventsAndHttp";
import { ManualClock } from "../src/infrastructure/system/System";
import { testPlatform, wa } from "./helpers/platform";

const PT = "Urgente! O governo vai cortar a água amanhã em todo o país, segundo fontes. Compartilhe com todos, não é brincadeira.";
const EN = "Breaking: the government said that the water will be cut tomorrow in the whole country, according to sources.";
const detector = new StopwordLanguageDetector();

describe("Idiomas: detección", () => {
  test("castellano, portugués e inglés", () => {
    assert.equal(detectLanguage(PT).language, "pt");
    assert.ok(detectLanguage(PT).confidence >= 0.5);
    assert.equal(detectLanguage(EN).language, "en");
    assert.equal(detectLanguage("El gobierno dijo ayer que no habrá cortes de luz, según el ministro de Energía.").language, "es");
  });

  test("todo el set de evaluación (en castellano) se reconoce como castellano o sin seguridad", () => {
    for (const e of SEED_EVALUATION_SET) {
      const d = detectLanguage(e.text);
      assert.ok(d.language === "es" || d.confidence < 0.5, `${d.language} ${d.confidence}: ${e.text.slice(0, 60)}`);
    }
  });

  test("textos cortos o sin palabras: sin seguridad", () => {
    assert.equal(detectLanguage("ok 👍").confidence, 0);
    assert.equal(detectLanguage("https://example.com/nota").confidence, 0);
  });
});

describe("Idiomas: comandos", () => {
  const p = new MultilingualCommandParser(new SpanishCommandParser());

  test("portugués e inglés → el mismo comando", () => {
    assert.deepEqual(p.parse("/ajuda"), { type: "help" });
    assert.deepEqual(p.parse("/help"), { type: "help" });
    assert.deepEqual(p.parse("/resumo semanal"), { type: "digest_set", frequency: "weekly" });
    assert.deepEqual(p.parse("/digest daily"), { type: "digest_set", frequency: "daily" });
    assert.deepEqual(p.parse("/audio sim"), { type: "audio_replies", on: true });
    assert.deepEqual(p.parse("/save https://diario.example/Nota watch"), { type: "archive_url", url: "https://diario.example/Nota", monitor: true });
    assert.deepEqual(p.parse("/idioma pt"), { type: "set_language", language: "pt" });
    assert.deepEqual(p.parse("/language en"), { type: "set_language", language: "en" });
  });

  test("el texto libre de un comando no se toca; lo que no es comando pasa igual", () => {
    assert.deepEqual(p.parse("/suporte não consigo entrar"), { type: "support", text: "não consigo entrar" });
    assert.deepEqual(p.parse("/formato curto"), { type: "set_format", format: "short" });
    assert.equal(p.parse(PT).type, "analyze_content");
  });
});

describe("Idiomas: traducción", () => {
  const content: ResponseContent = {
    kind: "result",
    title: "Tiene humo",
    summary: "Mirá la nota en https://diario.example/a?x=1 y escribí /comparar tarifas.",
    sections: [{ heading: "Humo", lines: ["¿Te sirvió? Respondé SÍ o NO.", "Escribile a @sinhumo"] }],
    links: [{ label: "Ver nota", url: "https://diario.example/a" }],
    footer: "Para no recibir más avisos, respondé BAJA.",
  };

  test("respuesta traducida en una sola llamada; links, comandos y palabras clave intactos", async () => {
    const tr = new FakeTranslator();
    const out = await new ResponseLocalizer(tr).localize(content, "pt");
    assert.equal(tr.calls.length, 1);
    assert.equal(out.title, "[pt] Tiene humo");
    assert.equal(out.summary, "[pt] Mirá la nota en https://diario.example/a?x=1 y escribí /comparar tarifas.");
    assert.equal(out.sections[0]!.lines[0], "[pt] ¿Te sirvió? Respondé SÍ o NO.");
    assert.equal(out.links[0]!.url, "https://diario.example/a");
    assert.equal(out.links[0]!.label, "[pt] Ver nota");
    // Lo protegido viaja como marcador (el traductor no lo ve).
    assert.ok(tr.calls[0]!.texts.every((t) => !t.includes("https://") && !t.includes("/comparar") && !t.includes("BAJA")));
  });

  test("si el traductor falla, la respuesta sale en castellano", async () => {
    const broken: ITranslator = { id: "roto", translate: async () => { throw new Error("caído"); } };
    assert.deepEqual(await new ResponseLocalizer(broken).localize(content, "en"), content);
    assert.equal(await new ResponseLocalizer(new FakeTranslator()).localize(content, "es"), content, "castellano: sin tocar");
  });

  test("caché: no se traduce (ni se paga) dos veces lo mismo", async () => {
    const inner = new FakeTranslator();
    let paid = 0;
    const tr = new CachedTranslator(new MeteredTranslator(inner, async (_p, chars) => void (paid += chars)), new MemoryTtlCache(new ManualClock(new Date())));
    assert.deepEqual(await tr.translate(["Hola", "Chau"], "pt"), ["[pt] Hola", "[pt] Chau"]);
    assert.deepEqual(await tr.translate(["Hola", "Nuevo"], "pt"), ["[pt] Hola", "[pt] Nuevo"]);
    assert.deepEqual(inner.calls.map((c) => c.texts), [["Hola", "Chau"], ["Nuevo"]]);
    assert.equal(paid, "HolaChauNuevo".length);
  });

  test("mensajes y notas en otros idiomas se traducen antes de analizarlos", async () => {
    const tr = new FakeTranslator();
    const seen: string[] = [];
    const smoke = new TranslatingSmokeDetector({ version: "v", analyze: async (t): Promise<SmokeAnalysis> => (seen.push(t), { smokeIndex: 0, facts: [], findings: [], cleanVersion: t }) }, detector, tr);
    await smoke.analyze(PT);
    await smoke.analyze("El gobierno dijo que mañana hay paro de transporte en todo el país.");
    assert.deepEqual(seen, [`[es] ${PT}`, "El gobierno dijo que mañana hay paro de transporte en todo el país."]);
    assert.equal(smoke.version, "v");

    const got: Article[] = [];
    const x = new TranslatingClaimExtractor({ extract: async (a): Promise<Claim[]> => (got.push(a), []) }, detector, tr);
    await x.extract({ id: "a", outletId: "o", url: "https://folha.example/x", title: "Governo anuncia corte", body: PT, publishedAt: new Date(), region: { country: "BR" }, topic: "agua" } as Article);
    assert.equal(got[0]!.title, "[es] Governo anuncia corte");
    assert.equal(tr.calls.at(-1)!.from, "pt");
  });

  test("adaptadores: DeepL (clave gratuita, variante regional), Google y la IA", async () => {
    const reqs: { url: string; body: unknown; headers?: Record<string, string> }[] = [];
    const http = new StubHttpClient((_m, url, body) => {
      reqs.push({ url, body });
      return url.includes("deepl")
        ? { status: 200, text: JSON.stringify({ translations: [{ text: "Olá" }] }) }
        : { status: 200, text: JSON.stringify({ data: { translations: [{ translatedText: "Hello" }] } }) };
    });
    assert.deepEqual(await new DeepLTranslator(http, "clave:fx").translate(["Hola"], "pt", "es"), ["Olá"]);
    assert.equal(reqs[0]!.url, "https://api-free.deepl.com/v2/translate");
    assert.deepEqual(reqs[0]!.body, { text: ["Hola"], target_lang: "PT-BR", source_lang: "ES", preserve_formatting: true });
    assert.deepEqual(await new GoogleTranslator(http, "K").translate(["Hola"], "en"), ["Hello"]);
    assert.match(reqs[1]!.url, /translate\/v2\?key=K$/);

    const llm = new LLMTranslator({ completeJSON: async <T>() => ({ data: { texts: ["uno"] } as T }) });
    await assert.rejects(llm.translate(["a", "b"], "en"), /todos los textos/);
  });
});

describe("Idiomas: en el chat", () => {
  test("quien escribe en portugués recibe las respuestas en portugués; /idioma lo cambia; se mide el costo", async () => {
    const tr = new FakeTranslator();
    const t = await testPlatform({ extra: { translator: tr } });
    const from = "+5511999990000";
    const r = await t.p.inbound.execute(wa(from, PT, t.clock.now()));
    assert.equal((await t.p.config.preferences.effective(r.user)).language, "pt", "detectado en el primer mensaje");
    assert.match(r.response.title, /^\[pt\] /);
    assert.ok(tr.calls.some((c) => c.to === "es" && c.from === "pt"), "el mensaje se tradujo al castellano para analizarlo");

    t.clock.advance(60_000);
    const en = await t.p.inbound.execute(wa(from, "/language en", t.clock.now()));
    assert.equal(en.response.title, "[en] Listo: te respondo en English.");
    t.clock.advance(60_000);
    const bad = await t.p.inbound.execute(wa(from, "/idioma klingon", t.clock.now()));
    assert.match(bad.response.summary!, /es \(Español\), pt \(Português\), en \(English\)/);

    const costs = (await t.store.repos.costs.findBetween(new Date(0), new Date("2100-01-01"))).filter((c) => c.kind === "translation");
    assert.ok(costs.length > 0 && costs.every((c) => c.provider === "fake-translator" && c.units.characters! > 0));
  });

  test("sin traductor: todo en castellano, y /idioma lo avisa", async () => {
    const t = await testPlatform();
    const r = await t.p.inbound.execute(wa("+5511988880000", PT, t.clock.now()));
    assert.equal((await t.p.config.preferences.effective(r.user)).language, "es");
    t.clock.advance(60_000);
    const pt = await t.p.inbound.execute(wa("+5511988880000", "/idioma pt", t.clock.now()));
    assert.equal(pt.response.title, "Por ahora respondo sólo en castellano.");
  });
});

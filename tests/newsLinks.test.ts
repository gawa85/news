/** Link a una nota: se analiza la nota (título y cuerpo), no el link. */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { IPageCapturer } from "../src/domain/ports";
import { sharedNewsLink } from "../src/domain/rules/newsLinks";
import { extractArticle } from "../src/infrastructure/content/ArticleExtractor";
import { testPlatform, userWithPlan, wa } from "./helpers/platform";
import { post, startWebApi } from "./helpers/webSession";

const BODY = "El Gobierno confirmó que la inflación de agosto fue del 2,1 %, según el INDEC. El dato se conoció el martes y es el más bajo del año. Los especialistas advirtieron que en septiembre podría subir por los aumentos de tarifas.";
const MENU = "<nav><a href='/'>Inicio</a> ¡IMPERDIBLE! Suscribite ya: la mejor oferta exclusiva del año</nav>";
const RELATED = "<aside><p>Notas relacionadas: URGENTE!!! Increíble lo que pasó, reenviá a todos, es histórico y catastrófico sin precedentes.</p></aside>";

const withJsonLd = `<html><head><title>Inflación | Medio</title><meta property="og:site_name" content="Medio de Prueba">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"x"},{"@type":"NewsArticle","headline":"La inflaci&oacute;n de agosto fue 2,1 %","articleBody":${JSON.stringify(BODY)},"datePublished":"2026-09-15T10:00:00-03:00","author":[{"@type":"Person","name":"Ana Periodista"}],"publisher":{"@type":"Organization","name":"Medio de Prueba"}}]}</script>
</head><body>${MENU}<article><p>${BODY}</p></article>${RELATED}</body></html>`;
const withArticle = `<html><head><meta property="og:title" content="Inflación de agosto"></head><body>${MENU}<article><h1>Inflación</h1><p>${BODY}</p><p>${BODY}</p></article>${RELATED}</body></html>`;
const onlyParagraphs = `<html><head><title>Inflación</title></head><body>${MENU}<div><p>${BODY}</p><p>Corto.</p></div></body></html>`;

describe("Links a notas", () => {
  test("el link de una nota (no de una red, casi sin texto alrededor) es para leer la nota", () => {
    assert.equal(sharedNewsLink("https://www.medio.example/economia/inflacion-agosto")?.hostname, "www.medio.example");
    assert.equal(sharedNewsLink("mirá esto https://www.medio.example/nota")?.pathname, "/nota");
    assert.equal(sharedNewsLink("https://x.com/juan/status/1"), undefined, "una red: la lee el lector de redes");
    assert.equal(sharedNewsLink("https://a.example/1 y https://b.example/2"), undefined);
    assert.equal(sharedNewsLink(`${"texto largo ".repeat(20)} https://a.example/1`), undefined, "un mensaje con un link: se analiza el mensaje");
  });

  test("del HTML sale sólo el cuerpo de la nota: primero el del medio para buscadores, después <article>, después los párrafos", () => {
    const a = extractArticle(withJsonLd);
    assert.equal(a.via, "json-ld");
    assert.equal(a.title, "La inflación de agosto fue 2,1 %");
    assert.equal(a.text, BODY);
    assert.equal(a.author, "Ana Periodista");
    assert.equal(a.siteName, "Medio de Prueba");
    assert.equal(a.publishedAt?.toISOString(), "2026-09-15T13:00:00.000Z");

    const b = extractArticle(withArticle);
    assert.equal(b.via, "article");
    assert.equal(b.title, "Inflación de agosto");
    assert.ok(b.text.includes("según el INDEC") && !/Suscribite|relacionadas/.test(b.text), "sin menú ni notas relacionadas");

    // Párrafos repetidos adentro del JavaScript de la página (como iProfesional): no cuentan.
    const inScript = extractArticle(`<html><body><script>window.__DATA__ = "<p>La discusi\u00f3n del proyecto termin\u00f3 en un fuerte enfrentamiento entre diputados<\/a></p>";</script><p>${BODY}</p></body></html>`);
    assert.equal(inScript.text, BODY);

    const c = extractArticle(onlyParagraphs);
    assert.equal(c.via, "paragraphs");
    assert.equal(c.text, BODY, "sólo los párrafos largos");
    assert.equal(extractArticle("<html><body><nav>menú</nav></body></html>").via, "none");
    // HTML armado para trabar: no se cuelga.
    const t0 = Date.now();
    extractArticle("<p".repeat(50_000) + "<script type='application/ld+json'>{".repeat(5_000));
    assert.ok(Date.now() - t0 < 2000);
  });

  describe("en Analizar y por el chat", () => {
    let t: Awaited<ReturnType<typeof testPlatform>>;
    let web: Awaited<ReturnType<typeof startWebApi>>;
    const pages = new Map<string, { status: number; html: string }>();
    const capturer: IPageCapturer = {
      id: "prueba",
      capture: async (url) => {
        const p = pages.get(url) ?? { status: 404, html: "no" };
        return { finalUrl: url, status: p.status, mime: "text/html", body: Buffer.from(p.html), text: "" };
      },
    };

    before(async () => {
      t = await testPlatform({ extra: { evidence: { capturer } } });
      web = await startWebApi(t);
      await t.store.repos.outlets.save({ id: "medio-prueba", name: "Medio de Prueba", url: "https://www.medio-prueba.example", kind: "digital", region: { country: "AR" } });
      pages.set("https://www.medio-prueba.example/economia/inflacion", { status: 200, html: withJsonLd });
      pages.set("https://portada.example/", { status: 200, html: "<html><body><nav>Portada</nav></body></html>" });
    });
    after(() => web.close());

    test("pegar el link de una nota: se analiza la nota y queda en el historial como nota del medio", async () => {
      const ana = await web.login("ana.nota@correo.example");
      const r = await ana("/v1/analyze", post({ text: "https://www.medio-prueba.example/economia/inflacion" }));
      assert.equal(r.status, 200);
      const a = (await r.json()) as { id: string; title: string; text: string; article: { title: string; outletName: string; author: string; chars: number }; origin: { label: string; url: string } };
      assert.equal(a.text, BODY, "se analizó el cuerpo de la nota, no el link");
      assert.equal(a.title, "La inflación de agosto fue 2,1 %");
      assert.deepEqual([a.article.outletName, a.article.author], ["Medio de Prueba", "Ana Periodista"]);
      assert.equal(a.origin.label, "Nota de Medio de Prueba (medio-prueba.example)");
      assert.equal(a.origin.url, "https://www.medio-prueba.example/economia/inflacion");
    });

    test("si no se puede leer la nota, se dice y se analiza el link como texto", async () => {
      const bea = await web.login("bea.nota@correo.example");
      const a = (await (await bea("/v1/analyze", post({ text: "https://portada.example/" }))).json()) as { text: string; articleError: string };
      assert.match(a.articleError, /No se pudo leer la nota \(No pude leer el texto de la nota/);
      assert.equal(a.text, "https://portada.example/");
      const c = (await (await bea("/v1/analyze", post({ text: "https://no-existe.example/nota" }))).json()) as { articleError: string };
      assert.match(c.articleError, /404/);
    });

    test("por WhatsApp: el link de una nota trae la nota y la analiza", async () => {
      const u = await userWithPlan(t, "personal");
      const phone = u.channels.find((c) => c.channel === "whatsapp")!.address;
      await t.p.inbound.execute(wa(phone, "https://www.medio-prueba.example/economia/inflacion", t.clock.now()));
      const out = JSON.stringify(t.whatsapp.outbox.at(-1));
      assert.match(out, /📰 Nota de Medio de Prueba/);
      assert.match(out, /La inflación de agosto fue 2,1 %/);
    });
  });
});

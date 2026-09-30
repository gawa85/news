/** Humo en las notas del catálogo: se mide con reglas al leerlas y suma a la credibilidad del medio. */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { CatalogSmokeMeter } from "../src/application/catalog/CatalogSmoke";
import { SOURCE_DIRECTORY } from "../src/config/sourceDirectory";
import type { Article } from "../src/domain/model";
import { LanguageSmokeDimension } from "../src/infrastructure/credibility/LanguageSmokeDimension";
import { RuleBasedSmokeDetector } from "../src/infrastructure/heuristics/RuleBasedSmokeDetector";
import { drainJobs, testPlatform } from "./helpers/platform";
import { post, startWebApi } from "./helpers/webSession";

const ALARMA = "URGENTE!!! Reenviá a todos: mañana aumenta todo, lo dijo un funcionario. ¡Increíble, histórico, catastrófico!";
const SOBRIA = "El INDEC informó que la inflación de agosto fue 2,1 %, según el informe publicado el martes.";
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>X</title>` +
  `<item><title>Aviso</title><link>https://humo.example/alarma</link><description>${ALARMA}</description><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item>` +
  `<item><title>Inflación de agosto</title><link>https://humo.example/sobria</link><description>${SOBRIA}</description><pubDate>Tue, 29 Sep 2026 11:00:00 GMT</pubDate></item></channel></rss>`;

const nota = (id: string, body: string, smoke?: Article["smoke"]): Article => ({
  id, outletId: "m", url: `https://m.example/${id}`, title: id, body, publishedAt: new Date("2026-09-01"), region: { country: "AR" }, topic: "inflación", smoke,
});

describe("Humo en las notas del catálogo", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let web: Awaited<ReturnType<typeof startWebApi>>;

  before(async () => {
    t = await testPlatform({ http: (_m, url) => (url === SOURCE_DIRECTORY.find((e) => e.id === "perfil")!.feedUrl ? { status: 200, text: RSS } : { status: 404, text: "no" }) });
    web = await startWebApi(t);
  });
  after(() => web.close());

  test("al leer un feed, cada nota nueva queda con su humo; se ve en las últimas notas del medio", async () => {
    const admin = await web.login("admin.humo@correo.example", ["platform_admin"]);
    await admin("/v1/catalog/directory/import", post({ ids: ["perfil"] }));
    const feed = (await t.store.repos.catalog.findFeeds("perfil"))[0]!;
    await admin(`/v1/catalog/outlets/perfil/feeds/${encodeURIComponent(feed.id)}/read`, post({}));

    const alarma = (await t.store.repos.articles.findByUrl("https://humo.example/alarma"))!;
    const sobria = (await t.store.repos.articles.findByUrl("https://humo.example/sobria"))!;
    assert.ok(alarma.smoke && sobria.smoke, "medidas");
    assert.ok(alarma.smoke.index > sobria.smoke.index, `${alarma.smoke.index} > ${sobria.smoke.index}`);
    assert.ok(alarma.smoke.types.length > 0);
    assert.match(alarma.smoke.version, /^reglas-/);

    const seen = (await (await admin("/v1/catalog/outlets/perfil/articles")).json()) as { latest: { smoke?: number }[]; smoke?: { measured: number; average: number } };
    assert.equal(seen.smoke?.measured, 2);
    assert.ok(seen.latest.every((a) => typeof a.smoke === "number"));
  });

  test("las notas guardadas antes se miden de a tandas (con la lectura automática)", async () => {
    await t.store.repos.articles.saveMany([nota("vieja-1", ALARMA), nota("vieja-2", SOBRIA)]);
    assert.ok((await t.store.repos.articles.unmeasured(1000)).some((a) => a.id === "vieja-1"));
    await t.p.jobs.queue.enqueue("ingest_feeds", {});
    await drainJobs(t);
    assert.ok((await t.store.repos.articles.findById("vieja-1"))!.smoke);
    assert.ok(!(await t.store.repos.articles.unmeasured(1000)).some((a) => a.id.startsWith("vieja-")));
  });

  test("el medidor: una nota que falla no frena a las demás; el límite se respeta", async () => {
    const saved: Article[] = [];
    const list = [nota("a", ALARMA), nota("b", "falla"), nota("c", SOBRIA)];
    const rules = new RuleBasedSmokeDetector();
    const meter = new CatalogSmokeMeter(
      { version: rules.version, analyze: (text) => (text.includes("falla") ? Promise.reject(new Error("x")) : rules.analyze(text)) },
      { unmeasured: async (n: number) => list.slice(0, n), saveMany: async (a: Article[]) => void saved.push(...a) } as never,
      { warn: () => undefined, info: () => undefined, error: () => undefined } as never,
    );
    assert.equal(await meter.backfill(2), 1);
    assert.deepEqual(saved.map((a) => a.id), ["a"]);
  });

  test("credibilidad: 'Humo en el lenguaje' promedia el humo de las notas; sin notas medidas no opina", async () => {
    const dim = new LanguageSmokeDimension();
    const ctx = (articles: Article[]) => ({ articles, claims: [], outlet: { id: "m" }, query: {} }) as never;
    const empty = await dim.evaluate(ctx([nota("x", "", undefined)]));
    assert.equal(empty.score, null);

    const r = await dim.evaluate(ctx([
      nota("x", "", { index: 80, types: ["alarmism", "chain_call"], version: "v" }),
      nota("y", "", { index: 20, types: ["alarmism"], version: "v" }),
    ]));
    assert.equal(r.score, 0.5);
    assert.match(r.summary, /Humo promedio: 50 de 100 en 2 notas/);
    assert.match(r.summary, /alarmismo \(2\)/);
    assert.deepEqual(r.evidence.map((e) => e.articleId), ["x"], "la de mucho humo, como ejemplo");
  });
});

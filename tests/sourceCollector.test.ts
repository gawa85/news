/**
 * Gracias a la inversión de dependencias, SourceCollector se prueba con dobles
 * de prueba escritos en pocas líneas: sin red, sin base de datos, sin IA.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SourceCollector } from "../src/application/SourceCollector";
import { ValidationError } from "../src/domain/errors";
import type { Article } from "../src/domain/model";
import type { IArticleFetcher, INewsSearchProvider, IOutletReader, ISourceSelectionPolicy } from "../src/domain/ports";
import { SilentLogger } from "../src/infrastructure/system/System";

const article = (url: string, outletId = "x"): Article => ({
  id: url, outletId, url, title: "t", body: "b", publishedAt: new Date("2026-03-01"), region: { country: "AR" }, topic: "gas",
});

const news = (items: Article[]): INewsSearchProvider => ({ search: async () => items });
const outlets: IOutletReader = { findById: async () => undefined, findAll: async () => [] };
const keepAll: ISourceSelectionPolicy = { select: (a) => a };
const fetcherOf = (map: Record<string, Article>): IArticleFetcher => ({
  fetch: async (url) => {
    const a = map[url];
    if (!a) throw new Error("404");
    return a;
  },
});
const query = { topic: "gas", period: { from: new Date("2026-01-01"), to: new Date("2026-12-31") } };

test("excluye dominios y restringe a onlyFrom", async () => {
  const c = new SourceCollector(
    news([article("https://a.example/1"), article("https://b.example/1"), article("https://c.example/1")]),
    fetcherOf({}), outlets, keepAll, new SilentLogger(),
  );
  const r = await c.collect({ ...query, urlRules: { onlyFrom: ["a.example", "b.example"], exclude: ["b.example"] } });
  assert.deepEqual(r.articles.map((a) => a.url), ["https://a.example/1"]);
  assert.equal(r.report.filteredOut, 2);
});

test("una URL incluida entra aunque la búsqueda no la traiga, y aunque esté excluida", async () => {
  const extra = article("https://b.example/especial");
  const c = new SourceCollector(news([article("https://a.example/1")]), fetcherOf({ [extra.url]: extra }), outlets, keepAll, new SilentLogger());
  const r = await c.collect({ ...query, urlRules: { include: [extra.url], exclude: ["b.example"] } });
  assert.deepEqual(r.articles.map((a) => a.url).sort(), ["https://a.example/1", extra.url]);
  assert.deepEqual(r.report.included, [extra.url]);
});

test("no duplica si la URL incluida ya vino en la búsqueda (con o sin www)", async () => {
  const c = new SourceCollector(news([article("https://www.a.example/1")]), fetcherOf({}), outlets, keepAll, new SilentLogger());
  const r = await c.collect({ ...query, urlRules: { include: ["https://a.example/1/"] } });
  assert.equal(r.articles.length, 1);
});

test("informa las URLs que no se pudieron traer, sin cortar el análisis", async () => {
  const c = new SourceCollector(news([article("https://a.example/1")]), fetcherOf({}), outlets, keepAll, new SilentLogger());
  const r = await c.collect({ ...query, urlRules: { include: ["https://caida.example/nota"] } });
  assert.equal(r.articles.length, 1);
  assert.equal(r.report.failedIncludes[0]?.url, "https://caida.example/nota");
});

test("rechaza patrones inválidos", async () => {
  const c = new SourceCollector(news([]), fetcherOf({}), outlets, keepAll, new SilentLogger());
  await assert.rejects(c.collect({ ...query, urlRules: { exclude: ["http://"] } }), ValidationError);
});

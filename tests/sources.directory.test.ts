/** Directorio de fuentes públicas conocidas: elegirlas en vez de escribir la dirección del feed. */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SOURCE_DIRECTORY } from "../src/config/sourceDirectory";
import { testPlatform } from "./helpers/platform";
import { post, startWebApi } from "./helpers/webSession";

const RSS = (title: string) => `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title><item><title>Nota de ${title}</title><link>https://ejemplo.com/nota</link><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
// RSS 1.0 (como el de DW): <rdf:RDF> y la fecha en dc:date.
const RDF = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>DW</title></channel><item><title>Nota de DW</title><link>https://www.dw.com/es/nota</link><dc:date>2026-09-29T10:00:00Z</dc:date></item></rdf:RDF>`;
const feedOf = (id: string) => SOURCE_DIRECTORY.find((e) => e.id === id)!.feedUrl;

type Dir = { available: boolean; limit: number | null; used: number; entries: { id: string; connected: boolean; category: string }[] };
type Added = { results: { id: string; ok: boolean; error?: string }[] };

describe("Directorio de fuentes públicas", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let web: Awaited<ReturnType<typeof startWebApi>>;
  const plan = async (userId: string, planId: string) => {
    const cur = await t.store.repos.subscriptions.findCurrent({ type: "user", id: userId });
    if (cur) await t.store.repos.subscriptions.save({ ...cur, status: "replaced" });
    await t.store.repos.subscriptions.save({ id: `sub-${userId}-${planId}`, subject: { type: "user", id: userId }, planId, status: "active", currentPeriodEnd: new Date("2027-06-01"), createdAt: new Date(t.clock.now().getTime() + 1000) });
  };

  before(async () => {
    t = await testPlatform({
      http: (_m, url) => {
        if (url === feedOf("dw")) return { status: 200, text: RDF };
        const e = SOURCE_DIRECTORY.find((x) => x.feedUrl === url);
        return e && e.id !== "caido" ? { status: 200, text: RSS(e.name) } : { status: 404, text: "no" };
      },
    });
    web = await startWebApi(t);
  });
  after(() => web.close());

  test("el directorio: fuentes verificadas de todos los tipos, sin repetir", () => {
    assert.ok(SOURCE_DIRECTORY.length >= 30);
    assert.equal(new Set(SOURCE_DIRECTORY.map((e) => e.id)).size, SOURCE_DIRECTORY.length);
    assert.equal(new Set(SOURCE_DIRECTORY.map((e) => e.feedUrl)).size, SOURCE_DIRECTORY.length);
    for (const c of ["nacional", "agencia", "verificador", "oficial", "internacional", "provincial"]) assert.ok(SOURCE_DIRECTORY.some((e) => e.category === c), c);
    assert.ok(SOURCE_DIRECTORY.every((e) => /^https:\/\//.test(e.feedUrl) && /^https:\/\//.test(e.site)));
  });

  test("elegir varias de una vez: se agregan (también RSS 1.0), quedan marcadas y no se repiten", async () => {
    const ana = await web.login("ana.directorio@correo.example");
    await plan(ana.userId, "profesional");
    const d0 = (await (await ana("/v1/sources/directory")).json()) as Dir;
    assert.equal(d0.available, true);
    assert.deepEqual([d0.limit, d0.used], [5, 0]);

    const r = (await (await ana("/v1/sources/directory/add", post({ ids: ["clarin", "dw", "chequeado"] }))).json()) as Added;
    assert.deepEqual(r.results.map((x) => [x.id, x.ok]), [["clarin", true], ["dw", true], ["chequeado", true]], JSON.stringify(r));
    const d1 = (await (await ana("/v1/sources/directory")).json()) as Dir;
    assert.equal(d1.used, 3);
    assert.deepEqual(d1.entries.filter((e) => e.connected).map((e) => e.id).sort(), ["chequeado", "clarin", "dw"]);

    const again = (await (await ana("/v1/sources/directory/add", post({ ids: ["clarin"] }))).json()) as Added;
    assert.equal(again.results[0]!.ok, true);
    assert.equal(((await (await ana("/v1/sources/directory")).json()) as Dir).used, 3, "no se duplica");

    assert.equal((await ana("/v1/sources/directory/add", post({ ids: ["no-existe"] }))).status, 400);
    assert.equal((await ana("/v1/sources/directory/add", post({ ids: [] }))).status, 400);
  });

  test("el plan manda: sin la función, nada; al llegar al límite, las que siguen no entran (y se dice por qué)", async () => {
    const free = await web.login("gratis.directorio@correo.example");
    const r0 = (await (await free("/v1/sources/directory/add", post({ ids: ["clarin", "infobae"] }))).json()) as Added;
    assert.ok(r0.results.every((x) => !x.ok && /plan/i.test(x.error!)));

    const bea = await web.login("bea.directorio@correo.example");
    await plan(bea.userId, "personal");
    const r1 = (await (await bea("/v1/sources/directory/add", post({ ids: ["lanacion", "infobae", "tn"] }))).json()) as Added;
    assert.deepEqual(r1.results.map((x) => x.ok), [true, false, false]);
    assert.match(r1.results[1]!.error!, /permite 1/);
  });

  test("catálogo general: cargar medios con su feed de una vez; volver a verificar", async () => {
    const reader = await web.login("lector.directorio@correo.example");
    assert.equal((await reader("/v1/catalog/directory")).status, 403);
    const admin = await web.login("admin.directorio@correo.example", ["platform_admin"]);
    const r = (await (await admin("/v1/catalog/directory/import", post({ ids: ["clarin", "bbcmundo", "lagaceta"] }))).json()) as { outlets: number; feeds: number };
    assert.deepEqual(r, { outlets: 3, feeds: 3 });
    const outlet = (await t.store.repos.outlets.findById("lagaceta"))!;
    assert.deepEqual([outlet.kind, outlet.region.province], ["newspaper", "Tucumán"]);
    assert.ok((await t.store.repos.catalog.findActiveFeeds()).some((f) => f.url === feedOf("bbcmundo")));
    const list = (await (await admin("/v1/catalog/directory")).json()) as { id: string; inCatalog: boolean; feedActive: boolean }[];
    assert.deepEqual(list.find((e) => e.id === "clarin"), { ...list.find((e) => e.id === "clarin")!, inCatalog: true, feedActive: true });
    assert.deepEqual(await (await admin("/v1/catalog/directory/import", post({ ids: ["clarin"] }))).json(), { outlets: 0, feeds: 0 }, "ya estaba");

    const checked = (await (await admin("/v1/catalog/directory/verify", post({}))).json()) as { id: string; ok: boolean; items: number }[];
    assert.equal(checked.length, SOURCE_DIRECTORY.length);
    assert.ok(checked.every((c) => c.ok && c.items === 1), "todas responden en la prueba");
  });
});

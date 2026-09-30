/** Directorio de fuentes públicas conocidas: elegirlas en vez de escribir la dirección del feed. */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SOURCE_DIRECTORY } from "../src/config/sourceDirectory";
import { testPlatform } from "./helpers/platform";
import { post, startWebApi } from "./helpers/webSession";

// Dos notas: una con texto y otra que es sólo un video (sin texto: se saltea, no frena a la otra).
const RSS = (title: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>` +
  `<item><title>Nota de ${title}</title><link>https://ejemplo.com/nota-${encodeURIComponent(title)}</link><description>URGENTE!!! Reenviá a todos: mañana aumenta todo, lo dijo un funcionario.</description><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item>` +
  `<item><title>Sólo un video</title><link>https://ejemplo.com/video-${encodeURIComponent(title)}</link><pubDate>Tue, 29 Sep 2026 11:00:00 GMT</pubDate></item></channel></rss>`;
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
    assert.ok(checked.every((c) => c.ok && c.items >= 1), "todas responden en la prueba");
  });

  test("leer ahora (persona): trae y analiza lo nuevo; como mucho una vez por minuto; sólo las propias", async () => {
    const eva = await web.login("eva.leer@correo.example");
    await plan(eva.userId, "profesional");
    await eva("/v1/sources/directory/add", post({ ids: ["perfil"] }));
    const conn = ((await (await eva("/v1/sources")).json()) as { connections: { id: string; name: string }[] }).connections.find((c) => c.name === "Perfil")!;
    t.clock.advance(61_000);

    const r = await eva(`/v1/sources/${conn.id}/sync`, post({}));
    assert.equal(r.status, 200);
    const res = (await r.json()) as { analyzed: number; withSmoke: number; error?: string };
    assert.equal(res.error, undefined);
    assert.equal(res.analyzed, 1);
    assert.equal((await eva(`/v1/sources/${conn.id}/sync`, post({}))).status, 409, "hace menos de un minuto");

    const other = await web.login("otra.leer@correo.example");
    assert.equal((await other(`/v1/sources/${conn.id}/sync`, post({}))).status, 404, "no es suya");
    t.clock.advance(61_000);
    assert.equal((await eva(`/v1/sources/${conn.id}/sync`, post({}))).status, 200);
  });

  test("leer ahora (catálogo): un feed en el momento; si falla, no se pierde desde dónde buscar; todos van a la cola una vez cada 5 minutos", async () => {
    const admin = await web.login("admin.leer@correo.example", ["platform_admin"]);
    await admin("/v1/catalog/directory/import", post({ ids: ["ambito"] }));
    const outlet = (await t.store.repos.outlets.findAll()).find((o) => o.id === "ambito")!;
    const feed = (await t.store.repos.catalog.findFeeds(outlet.id))[0]!;
    const url = `/v1/catalog/outlets/${outlet.id}/feeds/${encodeURIComponent(feed.id)}/read`;

    const first = (await (await admin(url, post({}))).json()) as { articles: number; feed: { lastFetchedAt: string } };
    assert.equal(first.articles, 2, "el catálogo guarda también la que sólo trae título");
    assert.equal((await admin(url, post({}))).status, 409);

    // El sitio se cae: el error queda, pero "desde cuándo buscar" no se mueve.
    await t.store.repos.catalog.saveFeed({ ...(await t.store.repos.catalog.findFeeds(outlet.id))[0]!, url: "https://caido.example/rss" });
    t.clock.advance(61_000);
    const failed = (await (await admin(url, post({}))).json()) as { articles: number; error?: string; feed: { lastFetchedAt: string; lastError: string } };
    assert.equal(failed.articles, 0);
    assert.ok(failed.error);
    assert.equal(failed.feed.lastFetchedAt, first.feed.lastFetchedAt, "no se saltean notas");
    assert.equal((await admin(url, post({}))).status, 409, "la espera cuenta aunque haya fallado");

    const reader = await web.login("lector.leer@correo.example");
    assert.equal((await reader("/v1/catalog/feeds/read-all", post({}))).status, 403);
    const all1 = await admin("/v1/catalog/feeds/read-all", post({}));
    assert.equal(all1.status, 202);
    assert.deepEqual(await all1.json(), { queued: true });
    assert.deepEqual(await (await admin("/v1/catalog/feeds/read-all", post({}))).json(), { queued: false }, "ya está pedido");
  });
});

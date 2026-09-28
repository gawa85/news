/** Herramientas de la web de personas: claves de API, alertas, "¿quién lo dijo primero?" y credibilidad en el tiempo. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { DEMO_TOPIC, demoDate } from "../src/demo/seedData";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { testPlatform } from "./helpers/platform";

const ORIGIN = "https://sinhumo.example";
const tokenFrom = (text: string) => text.match(/token=([\w-]+)/)![1]!;

describe("Web: herramientas del plan", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let base: string;
  let server: ReturnType<typeof createHttpApi>;

  const login = async (email: string, planId?: string) => {
    t.clock.advance(3_600_001); // (el freno contra el abuso admite 5 altas por hora desde la misma IP)
    await fetch(`${base}/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const r = await fetch(`${base}/auth/magic?token=${tokenFrom(t.mail.sent.at(-1)!.text)}`, { redirect: "manual" });
    const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
      fetch(`${base}${path}`, { ...init, headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...init.headers } });
    if (planId) {
      const me = (await (await call("/v1/me")).json()) as { id: string };
      const subject = { type: "user" as const, id: me.id };
      const cur = await t.store.repos.subscriptions.findCurrent(subject);
      if (cur) await t.store.repos.subscriptions.save({ ...cur, status: "replaced" });
      await t.store.repos.subscriptions.save({ id: `sub-${me.id}`, subject, planId, status: "active", currentPeriodEnd: new Date("2027-01-01"), createdAt: new Date(t.clock.now().getTime() + 1000) });
    }
    return call;
  };
  const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

  before(async () => {
    t = await testPlatform();
    server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await t.p.core.ingestArticles.execute({ topic: DEMO_TOPIC, period: { from: demoDate("2026-01-01"), to: demoDate("2026-08-31") } });
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test("claves de API: se crean con la sesión, la clave se ve una vez y una clave no puede crear otras", async () => {
    const free = await login("sin.api@correo.example");
    const listFree = (await (await free("/v1/api-keys")).json()) as { available: boolean };
    assert.equal(listFree.available, false);
    assert.equal((await free("/v1/api-keys", post({ name: "bot", scopes: ["content:analyze"] }))).status, 403);

    const pro = await login("pro.api@correo.example", "profesional");
    const list = (await (await pro("/v1/api-keys")).json()) as { available: boolean; scopes: string[] };
    assert.equal(list.available, true);
    assert.ok(list.scopes.includes("content:analyze"));
    assert.equal((await pro("/v1/api-keys", post({ name: "bot", scopes: [] }))).status, 400);
    assert.equal((await pro("/v1/api-keys", post({ name: "bot", scopes: ["platform:admin"] }))).status, 400, "alcance desconocido");

    const created = await pro("/v1/api-keys", post({ name: "bot", scopes: ["content:analyze"] }));
    assert.equal(created.status, 201);
    const { plaintext, key } = (await created.json()) as { plaintext: string; key: Record<string, unknown> };
    assert.match(plaintext, /^sh_live_/);
    assert.equal(key.hash, undefined);
    const keys = ((await (await pro("/v1/api-keys")).json()) as { keys: Record<string, unknown>[] }).keys;
    assert.equal(keys.length, 1);
    assert.equal(keys[0]!.hash, undefined);
    assert.equal(keys[0]!.userId, undefined);

    const bearer = { authorization: `Bearer ${plaintext}`, "content-type": "application/json" };
    assert.equal((await fetch(`${base}/v1/analyze`, { method: "POST", headers: bearer, body: JSON.stringify({ text: "Hola" }) })).status, 200);
    assert.equal((await fetch(`${base}/v1/api-keys`, { headers: bearer })).status, 403, "con una clave no se administran claves");

    assert.equal((await pro(`/v1/api-keys/${keys[0]!.id}/revoke`, post({}))).status, 200);
    assert.equal((await fetch(`${base}/v1/analyze`, { method: "POST", headers: bearer, body: JSON.stringify({ text: "Hola" }) })).status, 403, "revocada");
  });

  test("alertas: crear, listar y apagar (sólo las propias)", async () => {
    const free = await login("sin.alertas@correo.example");
    assert.equal((await free("/v1/alerts", post({ topic: "gas", trigger: "new_coverage", channel: "email" }))).status, 403);

    const pro = await login("con.alertas@correo.example", "personal");
    const r = await pro("/v1/alerts", post({ topic: "tarifas de gas", trigger: "new_coverage", channel: "email" }));
    assert.equal(r.status, 201);
    const alert = (await r.json()) as { id: string; topic: string; lastState?: unknown };
    assert.equal(alert.topic, "tarifas de gas");
    assert.equal((await pro("/v1/alerts", post({ topic: "gas", trigger: "credibility_change", channel: "email" }))).status, 400, "falta el medio");
    assert.equal((await pro("/v1/alerts", post({ topic: "gas", trigger: "new_coverage", channel: "whatsapp" }))).status, 400, "canal sin verificar");

    const other = await login("otra.persona@correo.example", "personal");
    assert.equal((await other(`/v1/alerts/${alert.id}/deactivate`, post({}))).status, 404);
    assert.deepEqual(await (await other("/v1/alerts")).json(), []);

    assert.equal(((await (await pro("/v1/alerts")).json()) as unknown[]).length, 1);
    assert.equal((await pro(`/v1/alerts/${alert.id}/deactivate`, post({}))).status, 200);
    assert.deepEqual(await (await pro("/v1/alerts")).json(), []);
  });

  test("¿quién lo dijo primero? a partir de un link (guardado o nuevo)", async () => {
    const free = await login("sin.origen@correo.example");
    assert.equal((await free("/v1/origin", post({ url: "https://www.diariodelvalle.example/economia/tarifas-gas-aumento" }))).status, 403);

    const call = await login("con.origen@correo.example", "personal");
    const r = await call("/v1/origin", post({ url: "https://diariodelvalle.example/economia/tarifas-gas-aumento?utm_source=x" }));
    assert.equal(r.status, 200);
    const trace = (await r.json()) as { target: { id: string; body?: string }; origin: { outletId: string }; chain: { article: { id: string } }[] };
    assert.equal(trace.target.id, "ddv-1", "encuentra la nota guardada por su URL canónica");
    assert.equal(trace.target.body, undefined, "no manda el cuerpo de las notas");
    assert.ok(trace.chain.length >= 2);

    assert.equal((await call("/v1/origin", post({ url: "https://revista-energia.example/analisis/tarifas-gas-2026" }))).status, 400, "nota nueva sin tema");
    const fresh = await call("/v1/origin", post({ url: "https://revista-energia.example/analisis/tarifas-gas-2026", topic: DEMO_TOPIC }));
    assert.equal(fresh.status, 200);
    assert.equal(((await fresh.json()) as { target: { id: string } }).target.id, "re-1");
    assert.ok(await t.store.repos.articles.findByUrl("https://revista-energia.example/analisis/tarifas-gas-2026"), "quedó guardada");
    assert.equal((await call("/v1/origin", post({ url: "javascript:alert(1)" }))).status, 400);
  });

  test("credibilidad en el tiempo: plan profesional", async () => {
    const body = { outletId: "ddv", topic: DEMO_TOPIC, from: "2026-01-01", to: "2026-08-31", windows: 2 };
    const personal = await login("personal.tl@correo.example", "personal");
    assert.equal((await personal("/v1/credibility/timeline", post(body))).status, 403);
    const pro = await login("pro.tl@correo.example", "profesional");
    const r = await pro("/v1/credibility/timeline", post(body));
    assert.equal(r.status, 200);
    const points = (await r.json()) as { period: { from: string }; report: { dimensions: unknown[] } }[];
    assert.equal(points.length, 2);
    assert.ok(points[0]!.report.dimensions.length > 0);
    assert.equal((await pro("/v1/credibility/timeline", post({ ...body, windows: 99 }))).status, 400);
  });
});

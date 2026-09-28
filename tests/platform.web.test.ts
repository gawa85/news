/** Lo que necesita la web de personas: sesión segura, "quién soy", historial, planes y medios. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { createHttpApi, localPath } from "../src/infrastructure/http/HttpApi";
import { FakeSocialSource } from "../src/infrastructure/social/SocialSources";
import { testPlatform, userWithPlan } from "./helpers/platform";

const ORIGIN = "https://sinhumo.example";
const tokenFrom = (text: string) => text.match(/token=([\w-]+)/)![1]!;
const TWEET = "https://x.com/juanp/status/1839999999999999999";
const CHAIN = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario.";

describe("Web: sesión y seguridad", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let base: string;
  let server: ReturnType<typeof createHttpApi>;
  let session: string;
  const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { cookie: session, origin: ORIGIN, "content-type": "application/json", ...init.headers } });

  before(async () => {
    const social = new FakeSocialSource();
    social.posts.set(TWEET, { platform: "x", url: TWEET, text: CHAIN, author: { name: "Juan", handle: "@juanp" } });
    t = await testPlatform({ extra: { social: { sources: [social] } } });
    server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await fetch(`${base}/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ana@correo.example" }) });
    const r = await fetch(`${base}/auth/magic?token=${tokenFrom(t.mail.sent.at(-1)!.text)}`, { redirect: "manual" });
    session = r.headers.get("set-cookie")!.split(";")[0]!;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test("el origen se compara exacto (no por prefijo) y el acceso con contraseña también lo controla", async () => {
    const body = JSON.stringify({ text: "Hola" });
    assert.equal((await call("/v1/analyze", { method: "POST", body, headers: { origin: "https://sinhumo.example.atacante.com" } })).status, 403);
    assert.equal((await call("/v1/analyze", { method: "POST", body, headers: { origin: "https://sinhumo.example:8443" } })).status, 403);
    assert.equal((await call("/v1/analyze", { method: "POST", body })).status, 200);
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: { origin: "https://atacante.example", "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.com", password: "x" }) });
    assert.equal(login.status, 403, "login CSRF");
  });

  test("PATCH y PUT leen el cuerpo (antes no se guardaban preferencias ni país)", async () => {
    const r = await call("/v1/me/preferences", { method: "PATCH", body: JSON.stringify({ responseFormat: "short", digest: "weekly" }) });
    assert.equal(r.status, 200);
    const p = (await r.json()) as { responseFormat: string; digest: string };
    assert.deepEqual([p.responseFormat, p.digest], ["short", "weekly"]);
    const c = await call("/v1/me/country", { method: "PUT", body: JSON.stringify({ country: "UY" }) });
    assert.equal(c.status, 200);
  });

  test("enlaces vencidos y errores de Google vuelven a la web con un aviso; /auth/logout no es un proveedor", async () => {
    const bad = await fetch(`${base}/auth/magic?token=vencido`, { redirect: "manual" });
    assert.equal(bad.status, 302);
    assert.equal(bad.headers.get("location"), "/entrar?error=enlace");
    assert.equal((await fetch(`${base}/auth/logout`)).status, 404);
  });

  test("el enlace del mail vuelve a la página que se estaba por ver (sólo rutas del sitio)", async () => {
    const ask = async (email: string, next: string) => {
      t.clock.advance(3_600_001); // (el freno contra el abuso admite 3 enlaces por hora al mismo mail)
      await fetch(`${base}/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, next }) });
      return fetch(`${base}/auth/magic?token=${tokenFrom(t.mail.sent.at(-1)!.text)}`, { redirect: "manual" });
    };
    assert.equal((await ask("ana@correo.example", "/unirme?token=abc")).headers.get("location"), "/unirme?token=abc");
    assert.equal((await ask("ana@correo.example", "//atacante.example")).headers.get("location"), "/");
    assert.equal((await ask("ana@correo.example", "https://atacante.example")).headers.get("location"), "/");
  });

  test("redirecciones sólo a rutas del sitio", () => {
    assert.equal(localPath("/cuenta"), true);
    assert.equal(localPath("/analizar?x=1"), true);
    for (const p of ["//atacante.com", "/\\atacante.com", "https://atacante.com", "cuenta", "/a\nb"]) assert.equal(localPath(p), false, p);
  });

  test("quién soy, historial y un análisis (sólo los propios)", async () => {
    const me = (await (await call("/v1/me")).json()) as { name: string; plan: { id: string; features: string[] }; usage: { analyses: number }; channels: { type: string }[] };
    assert.equal(me.plan.id, "gratis");
    assert.ok(me.plan.features.includes("content_analysis"));
    assert.equal(me.channels[0]!.type, "email");

    t.clock.advance(60_000); // (el historial va del más nuevo al más viejo)
    const analyzed = (await (await call("/v1/analyze", { method: "POST", body: JSON.stringify({ text: CHAIN }) })).json()) as { id: string; smokeIndex: number; text: string };
    assert.ok(analyzed.smokeIndex > 0);
    const list = (await (await call("/v1/me/analyses")).json()) as { id: string; excerpt: string }[];
    assert.equal(list[0]!.id, analyzed.id);
    const one = (await (await call(`/v1/me/analyses/${analyzed.id}`)).json()) as { text: string; findings: unknown[] };
    assert.equal(one.text, CHAIN);

    // El análisis de otra persona no existe para mí.
    const other = await userWithPlan(t, "gratis");
    const now = t.clock.now();
    const theirs = await t.p.gateway.analyzeContent({ userId: other.id, channel: "web" }, { id: "ajeno", sourceType: "message", origin: {}, text: "Texto de otra persona", urls: [], publishedAt: now, receivedAt: now, attachments: [], metadata: {} });
    assert.equal((await call(`/v1/me/analyses/${theirs.id}`)).status, 404);
    assert.equal((await call("/v1/me/analyses/no-existe")).status, 404);
  });

  test("analizar un link a una red lee la publicación; un link mal formado es un 400", async () => {
    const r = (await (await call("/v1/analyze", { method: "POST", body: JSON.stringify({ text: `¿Es cierto? ${TWEET}` }) })).json()) as { text: string; post: { author: { handle: string } } };
    assert.equal(r.text, CHAIN);
    assert.equal(r.post.author.handle, "@juanp");
    assert.equal((await call("/v1/analyze", { method: "POST", body: JSON.stringify({ text: "x", url: "no es un link" }) })).status, 400);
  });

  test("opciones de acceso: proveedores configurados y captcha", async () => {
    assert.deepEqual(await (await fetch(`${base}/public/auth-options`)).json(), { providers: ["google"], captcha: null });
  });

  test("públicos: planes para personas (con etiquetas) y medios ordenados", async () => {
    const plans = (await (await fetch(`${base}/public/plans`)).json()) as { id: string; features: { label: string }[] }[];
    assert.deepEqual(plans.map((p) => p.id), ["gratis", "personal", "profesional"]);
    assert.ok(plans[0]!.features.every((f) => f.label.length > 3));
    const outlets = (await (await fetch(`${base}/public/outlets`)).json()) as { name: string }[];
    assert.ok(outlets.length > 0);
    assert.deepEqual(outlets.map((o) => o.name), [...outlets.map((o) => o.name)].sort((a, b) => a.localeCompare(b, "es")));
  });
});

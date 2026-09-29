/** Backoffice en la web: temas, documentos oficiales, costos, copias de seguridad y catálogo (con sus frenos). */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { ConflictError } from "../src/domain/errors";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { MemoryBackupSink } from "../src/infrastructure/ops/BackupSinks";
import { createMemoryStore } from "../src/infrastructure/persistence/stores";
import { testPlatform, withRoles } from "./helpers/platform";

const ORIGIN = "https://sinhumo.example";
const tokenFrom = (text: string) => text.match(/token=([\w-]+)/)![1]!;

describe("Web: backoffice", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let base: string;
  let server: ReturnType<typeof createHttpApi>;

  const login = async (email: string, roles: string[] = []) => {
    t.clock.advance(3_600_001); // (el freno contra el abuso admite 5 altas por hora desde la misma IP)
    await fetch(`${base}/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const r = await fetch(`${base}/auth/magic?token=${tokenFrom(t.mail.sent.at(-1)!.text)}`, { redirect: "manual" });
    const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
      fetch(`${base}${path}`, { ...init, headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...init.headers } });
    const me = (await (await call("/v1/me")).json()) as { id: string };
    if (roles.length) await withRoles(t, me.id, roles);
    return Object.assign(call, { userId: me.id });
  };
  const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

  before(async () => {
    t = await testPlatform({ extra: { backups: { sink: new MemoryBackupSink(), passphrase: "una-frase-de-cifrado-muy-larga-2026", scratch: () => createMemoryStore() } } });
    server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test("temas: árbol completo sólo para quien edita; datos malformados dan 400 (no 500); el árbol público no dice quién editó", async () => {
    const reader = await login("lector.temas@correo.example");
    assert.equal((await reader("/v1/taxonomy")).status, 403);

    const editor = await login("editora.temas@correo.example", ["business_manager"]);
    const cat = (await (await editor("/v1/taxonomy")).json()) as { id: string; topics: { id: string }[] }[];
    assert.ok(cat.length > 0);

    assert.equal((await editor("/v1/taxonomy/topics", post({ categoryId: cat[0]!.id, keywords: ["x"] }))).status, 400, "sin nombre");
    assert.equal((await editor("/v1/taxonomy/topics", post({ name: "yerba", categoryId: cat[0]!.id }))).status, 400, "sin palabras clave");
    assert.equal((await editor("/v1/taxonomy/topics", post({ name: "yerba", categoryId: cat[0]!.id, keywords: "yerba" }))).status, 400, "palabras clave que no son lista");
    assert.equal((await editor("/v1/taxonomy/categories", post({ name: 42 }))).status, 400);

    const saved = await editor("/v1/taxonomy/topics", post({ name: "Yerba mate", categoryId: cat[0]!.id, keywords: ["yerba", 7, " mate "], countries: ["ar", "no-es-país"], updatedBy: "alguien-más" }));
    assert.equal(saved.status, 200);
    const topic = (await saved.json()) as { id: string; keywords: string[]; countries: string[]; updatedBy: string };
    assert.deepEqual(topic.keywords, ["yerba", "mate"]);
    assert.deepEqual(topic.countries, ["AR"]);
    assert.equal(topic.updatedBy, editor.userId, "quién editó lo pone el sistema");

    assert.equal((await editor("/v1/taxonomy/topics", post({ id: topic.id, name: "yerba mate", categoryId: cat[0]!.id, keywords: ["yerba"], active: false }))).status, 200);
    const full = (await (await editor("/v1/taxonomy")).json()) as { topics: { id: string; active: boolean }[] }[];
    assert.equal(full.flatMap((c) => c.topics).find((x) => x.id === topic.id)?.active, false, "lo desactivado se ve en el backoffice");

    const pub = JSON.stringify(await (await fetch(`${base}/public/topics`)).json());
    assert.ok(!pub.includes("updatedBy") && !pub.includes(editor.userId));
    assert.ok(!pub.includes(topic.id), "lo desactivado no es público");
  });

  test("documentos oficiales: sólo los campos del documento (el id y quién lo subió no se pueden elegir)", async () => {
    const checker = await login("verif.docs@correo.example", ["fact_checker"]);
    const bad = await checker("/v1/verification/documents", post({ title: "Res. 1", issuer: "ENARGAS", url: "https://boletin.example/1", publishedAt: "2026-09-01" }));
    assert.equal(bad.status, 400, "sin texto");
    const r = await checker("/v1/verification/documents", post({
      id: "doc-elegido", uploadedBy: "otra-persona", admin: true,
      title: "Resolución 45", issuer: "ENARGAS", url: "https://boletin.example/45", publishedAt: "2026-09-01", text: "Aumento del 30% en la tarifa.", topics: ["Gas", 3],
    }));
    assert.equal(r.status, 201);
    const doc = (await r.json()) as Record<string, unknown>;
    assert.notEqual(doc.id, "doc-elegido");
    assert.equal(doc.uploadedBy, checker.userId);
    assert.equal(doc.admin, undefined);
    assert.deepEqual(doc.topics, ["gas"]);
  });

  test("calidad: la etiqueta de un ejemplo sólo admite tipos de humo conocidos, como lista", async () => {
    const checker = await login("verif.calidad@correo.example", ["fact_checker"]);
    const text = "Una oferta increíble que te cambia la vida para siempre.";
    assert.equal((await checker("/v1/quality/examples", post({ text, isSmoke: true, types: "marketing" }))).status, 400, "un texto no es una lista");
    assert.equal((await checker("/v1/quality/examples", post({ text, isSmoke: true, types: ["inventado"] }))).status, 400);
    assert.equal((await checker("/v1/quality/examples", post({ text, isSmoke: false, types: ["marketing"] }))).status, 400);
    const ok = await checker("/v1/quality/examples", post({ text, isSmoke: true, types: ["marketing", "marketing"] }));
    assert.equal(ok.status, 201);
    assert.deepEqual(((await ok.json()) as { expected: unknown }).expected, { isSmoke: true, types: ["marketing"] });
  });

  test("fe de erratas: publicar una corrección propia; validada y pública sin quién la publicó", async () => {
    const reader = await login("lector.erratas@correo.example");
    const body = { target: { type: "methodology", id: "ponderación de fuentes" }, description: "Corregimos el peso de las fuentes oficiales: contaba doble en la precisión." };
    assert.equal((await reader("/v1/corrections", post(body))).status, 403);

    const checker = await login("verif.erratas@correo.example", ["fact_checker"]);
    assert.equal((await checker("/v1/corrections", post({ ...body, target: { type: "cualquiera", id: "x" } }))).status, 400);
    assert.equal((await checker("/v1/corrections", post({ ...body, description: "corto" }))).status, 400);
    assert.equal((await checker("/v1/corrections", post({ ...body, outletId: "no-existe" }))).status, 404);
    const [outlet] = await t.store.repos.outlets.findAll();
    const r = await checker("/v1/corrections", post({ ...body, outletId: outlet!.id, publishedBy: "otra", id: "elegido" }));
    assert.equal(r.status, 201);
    const c = (await r.json()) as { id: string; publishedBy: string };
    assert.notEqual(c.id, "elegido");
    assert.equal(c.publishedBy, checker.userId);
    const pub = (await (await fetch(`${base}/public/corrections`)).json()) as Record<string, unknown>[];
    const mine = pub.find((x) => x.id === c.id)!;
    assert.equal(mine.publishedBy, undefined);
    assert.deepEqual(mine.target, { type: "methodology", id: "ponderación de fuentes" });
  });

  test("costos: el período tiene tope y orden", async () => {
    const admin = await login("admin.costos@correo.example", ["platform_admin"]);
    assert.equal((await admin("/v1/costs?from=2026-01-01&to=2026-03-01")).status, 200);
    assert.equal((await admin("/v1/costs?from=2026-03-01&to=2026-01-01")).status, 400);
    assert.equal((await admin("/v1/costs?from=2000-01-01&to=2026-01-01")).status, 400, "más de un año");
  });

  test("copias: crear, listar y verificar desde la web; una operación por vez; sólo copias de la lista", async () => {
    const reader = await login("lector.copias@correo.example");
    assert.equal((await reader("/v1/ops/backups", post({}))).status, 403);

    const admin = await login("admin.copias@correo.example", ["platform_admin"]);
    const created = await admin("/v1/ops/backups", post({}));
    assert.equal(created.status, 201);
    const { key } = (await created.json()) as { key: string };
    const list = (await (await admin("/v1/ops/backups")).json()) as { key: string }[];
    assert.ok(list.some((m) => m.key === key));

    const verified = (await (await admin("/v1/ops/backups/verify", post({ key }))).json()) as { verification: { ok: boolean } };
    assert.equal(verified.verification.ok, true);
    assert.equal((await admin("/v1/ops/backups/verify", post({ key: "../../etc/passwd" }))).status, 404);

    const both = await Promise.allSettled([t.p.backups!.createManual(admin.userId), t.p.backups!.createManual(admin.userId)]);
    assert.equal(both.filter((x) => x.status === "fulfilled").length, 1);
    assert.ok(both.some((x) => x.status === "rejected" && x.reason instanceof ConflictError), "la segunda espera a la primera");
  });

  test("medios: crear y editar uno suelto (el id no cambia) y sus feeds; sin permiso, nada", async () => {
    const reader = await login("lector.medios@correo.example");
    assert.equal((await reader("/v1/catalog/outlets", post({ name: "X", url: "https://x.example", kind: "digital", region: { country: "AR" } }))).status, 403);

    const admin = await login("admin.medios.sueltos@correo.example", ["platform_admin"]);
    const bad = [
      { name: "", url: "https://a.example", kind: "digital", region: { country: "AR" } },
      { name: "Diario Sur", url: "javascript:alert(1)", kind: "digital", region: { country: "AR" } },
      { name: "Diario Sur", url: "https://sur.example", kind: "blog", region: { country: "AR" } },
      { name: "Diario Sur", url: "https://sur.example", kind: "digital", region: { country: "ZZ" } },
    ];
    for (const d of bad) assert.equal((await admin("/v1/catalog/outlets", post(d))).status, 400, JSON.stringify(d));

    const created = await admin("/v1/catalog/outlets", post({ name: "Diario Sur", url: "https://sur.example", kind: "newspaper", region: { country: "ar", province: "Chubut", extra: "x" }, aliases: ["El Sur", "Diario Sur"] }));
    assert.equal(created.status, 200);
    const outlet = (await created.json()) as { id: string; region: Record<string, unknown>; aliases: string[] };
    assert.equal(outlet.id, "diario-sur");
    assert.deepEqual(outlet.region, { country: "AR", province: "Chubut" });
    assert.deepEqual(outlet.aliases, ["El Sur"]);
    assert.equal((await admin("/v1/catalog/outlets", post({ name: "Diario Sur", url: "https://sur.example", kind: "newspaper", region: { country: "AR" } }))).status, 409, "ya existe");

    const edited = (await (await admin("/v1/catalog/outlets", post({ id: "diario-sur", name: "Diario del Sur", url: "https://sur.example", kind: "digital", region: { country: "AR" } }))).json()) as { id: string; name: string };
    assert.deepEqual([edited.id, edited.name], ["diario-sur", "Diario del Sur"]);

    assert.equal((await admin("/v1/catalog/outlets/diario-sur/feeds", post({ url: "file:///etc/passwd" }))).status, 400);
    const feed = (await (await admin("/v1/catalog/outlets/diario-sur/feeds", post({ url: "https://sur.example/rss" }))).json()) as { id: string };
    assert.equal((await admin(`/v1/catalog/outlets/diario-sur/feeds/${encodeURIComponent(feed.id)}/deactivate`, post({}))).status, 200);
    const rec = (await (await admin("/v1/catalog/outlets/diario-sur")).json()) as { outlet: { name: string }; feeds: { active: boolean }[] };
    assert.equal(rec.outlet.name, "Diario del Sur");
    assert.deepEqual(rec.feeds.map((f) => f.active), [false]);
    assert.ok(!(await t.store.repos.catalog.findActiveFeeds()).some((f) => f.id === feed.id), "desactivado, no se descarga");
  });

  test("catálogo: fuentes configuradas y CSV subido desde la web", async () => {
    const reader = await login("lector.catalogo@correo.example");
    assert.equal((await reader("/v1/catalog/sources")).status, 403);

    const admin = await login("admin.catalogo@correo.example", ["platform_admin"]);
    const src = (await (await admin("/v1/catalog/sources")).json()) as { sources: unknown[]; csvUpload: boolean };
    assert.equal(src.csvUpload, true);
    assert.equal((await admin("/v1/catalog/import-csv", post({ kind: "cualquiera", text: "a,b" }))).status, 400);

    const csv = "id,nombre,url,tipo,pais,provincia\nel-litoral,El Litoral,https://litoral.example,digital,AR,Santa Fe\nsin-url,Sin URL,,digital,AR,";
    const r = await admin("/v1/catalog/import-csv", post({ kind: "outlets", text: csv }));
    assert.equal(r.status, 200);
    const report = (await r.json()) as { outlets: number; unmatched: string[] };
    assert.equal(report.outlets, 1);
    assert.equal(report.unmatched.length, 1);
    assert.ok(await t.store.repos.outlets.findById("el-litoral"));
  });
});

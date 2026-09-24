/** 3.5: archivo de evidencias (copias con huella, cadena, sello de tiempo y seguimiento de ediciones). */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { AccessDeniedError, NotFoundError, ValidationError } from "../src/domain/errors";
import { compareEvidenceText, evidenceUrlKey } from "../src/domain/rules/evidence";
import {
  buildTimestampRequest,
  FakeExternalArchive,
  FakePageCapturer,
  FakeTimestampAuthority,
  parseTimestampResponse,
  WaybackMachineArchive,
} from "../src/infrastructure/evidence/EvidenceAdapters";
import { htmlToText, HttpPageCapturer, isPublicAddress } from "../src/infrastructure/evidence/HttpPageCapturer";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { StubHttpClient } from "../src/infrastructure/system/EventsAndHttp";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

const NOTE = "https://diario.example/politica/tarifas";
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

async function evidencePlatform() {
  const pages = new FakePageCapturer();
  const tsa = new FakeTimestampAuthority();
  const archive = new FakeExternalArchive();
  const t = await testPlatform({ extra: { evidence: { capturer: pages, timestamp: tsa, archives: [archive] } } });
  pages.set(NOTE, "Suben las tarifas", ["El gas aumenta 30% en marzo.", "Lo anunció el ministro Pérez."]);
  const u = await userWithPlan(t, "profesional");
  return { t, pages, tsa, archive, u };
}

/** Respuesta falsa de `fetch`. */
const reply = (body: string | Buffer, status = 200, headers: Record<string, string> = {}) =>
  new Response(status >= 300 && status < 400 ? null : new Uint8Array(Buffer.from(body)), { status, headers });

describe("Evidencias: reglas", () => {
  test("misma nota aunque cambie el seguimiento, el www, el ancla o la barra final", () => {
    const k = evidenceUrlKey("https://www.Diario.example/nota/123/?utm_source=wa&fbclid=x&id=7#comentarios");
    assert.equal(k, "https://diario.example/nota/123?id=7");
    assert.equal(evidenceUrlKey("https://diario.example/nota/123?id=7"), k);
    assert.notEqual(evidenceUrlKey("https://diario.example/nota/123?id=8"), k, "otros parámetros sí distinguen notas");
  });

  test("qué frases aparecieron y cuáles desaparecieron", () => {
    const c = compareEvidenceText("El gas aumenta 30%. Lo anunció Pérez.", "El gas aumenta 45%. Lo anunció Pérez. Fuentes oficiales lo confirmaron.");
    assert.deepEqual(c, { added: ["El gas aumenta 45%.", "Fuentes oficiales lo confirmaron."], removed: ["El gas aumenta 30%."] });
  });
});

describe("Evidencias: descarga con protección SSRF", () => {
  test("direcciones públicas y no públicas", () => {
    for (const ip of ["8.8.8.8", "200.45.1.10", "2800:3f0:4002::200e", "::ffff:8.8.8.8"]) assert.equal(isPublicAddress(ip), true, ip);
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  test("bloquea metadatos de la nube, nombres internos, puertos raros, otros protocolos y redirecciones hacia adentro", async () => {
    const dns: Record<string, string[]> = { "diario.example": ["200.45.1.10"], "interno.example": ["10.0.0.5"], "mixto.example": ["200.45.1.10", "127.0.0.1"] };
    const fetched: string[] = [];
    const cap = new HttpPageCapturer({}, async (h) => dns[h] ?? [], async (input) => {
      fetched.push(String(input));
      if (String(input).endsWith("/salto")) return reply("", 302, { location: "http://169.254.169.254/latest/meta-data/" });
      return reply("<html><title>Hola</title><p>Nota</p></html>", 200, { "content-type": "text/html" });
    });
    for (const bad of ["http://169.254.169.254/latest/meta-data/", "http://interno.example/", "http://mixto.example/", "https://diario.example:22/", "file:///etc/passwd", "http://usuario:clave@diario.example/", "http://[::1]/"]) {
      await assert.rejects(cap.capture(bad, 1000), ValidationError, bad);
    }
    await assert.rejects(cap.capture("https://diario.example/salto", 1000), /no es una página pública/);
    assert.deepEqual(fetched, ["https://diario.example/salto"], "nunca llegó a pedir la dirección interna");
    const ok = await cap.capture("https://diario.example/nota", 1000);
    assert.equal(ok.title, "Hola");
  });

  test("sigue redirecciones públicas, corta las páginas enormes y extrae sólo el texto visible", async () => {
    const cap = new HttpPageCapturer({}, async () => ["200.45.1.10"], async (input) => {
      const u = String(input);
      if (u.endsWith("/vieja")) return reply("", 301, { location: "/nueva" });
      if (u.endsWith("/enorme")) return reply("x".repeat(5000), 200, { "content-type": "text/html" });
      return reply("<html><head><title>T</title><script>alert(1)</script></head><body><h1>Título</h1><p>Uno &amp; dos</p><style>p{}</style></body></html>", 200, { "content-type": "text/html" });
    });
    const r = await cap.capture("https://diario.example/vieja", 1000);
    assert.equal(r.finalUrl, "https://diario.example/nueva");
    assert.equal(r.text, "Título\nUno & dos");
    await assert.rejects(cap.capture("https://diario.example/enorme", 1000), /demasiado grande/);
    assert.equal(htmlToText("<p>a<!-- oculto --></p><noscript>b</noscript>").text, "a");
  });
});

describe("Evidencias: terceros", () => {
  test("RFC 3161: pedido DER y lectura de la respuesta", () => {
    const hash = sha("hola");
    const req = buildTimestampRequest(hash, Buffer.alloc(8, 0xab));
    assert.equal(req.length, 69);
    assert.equal(req.subarray(0, 2).toString("hex"), "3043");
    assert.ok(req.includes(Buffer.from(hash, "hex")));
    assert.equal(req[req.length - 1], 0xff, "pide el certificado");

    const token = Buffer.concat([Buffer.from("3080", "hex"), Buffer.from(hash, "hex"), Buffer.from([0x18, 0x0f]), Buffer.from("20260924153000Z", "latin1")]);
    const status = Buffer.from("3003020100", "hex");
    const resp = Buffer.concat([Buffer.from([0x30, status.length + token.length]), status, token]);
    assert.deepEqual(parseTimestampResponse(resp, hash), { status: 0, at: new Date("2026-09-24T15:30:00Z") });
    assert.throws(() => parseTimestampResponse(resp, sha("otra cosa")), /no corresponde/);
    assert.equal(parseTimestampResponse(Buffer.from("30053003020102", "hex"), hash).status, 2);
  });

  test("Wayback Machine: devuelve el link de la copia", async () => {
    const http = new StubHttpClient(() => ({ status: 200, text: "", headers: { "content-location": "/web/20260924153000/https://diario.example/nota" } }) as never);
    const r = await new WaybackMachineArchive(http).archive("https://diario.example/nota");
    assert.equal(r.url, "https://web.archive.org/web/20260924153000/https://diario.example/nota");
    assert.equal(r.at.toISOString(), "2026-09-24T15:30:00.000Z");
  });
});

describe("Evidencias: servicio", () => {
  test("captura: huellas, copias guardadas, cadena y sello por la cola", async () => {
    const { t, tsa, archive, u } = await evidencePlatform();
    const { snapshot: s } = await t.p.evidence.capture({ actorId: u.id, url: `${NOTE}?utm_source=whatsapp` });
    assert.equal(s.status, "captured");
    assert.equal(s.urlKey, NOTE);
    assert.equal(s.title, "Suben las tarifas");
    const raw = await t.p.evidence.content(u.id, s.id, "raw");
    assert.equal(sha(raw.data), s.rawSha256);
    assert.equal((await t.p.evidence.content(u.id, s.id, "text")).data.toString(), "El gas aumenta 30% en marzo.\nLo anunció el ministro Pérez.");

    const pending = await t.p.evidence.verify(u.id, s.id);
    assert.equal(pending.ok, false);
    assert.deepEqual(pending.checks.find((c) => c.name === "Sello de tiempo"), { name: "Sello de tiempo", ok: false, detail: "Pendiente." });

    // La cola hace el sello y la copia pública.
    const ran = await t.p.jobs.worker().runOnce();
    assert.ok(ran.ran >= 1);
    assert.deepEqual(tsa.stamped, [s.recordHash]);
    assert.deepEqual(archive.archived, [`${NOTE}?utm_source=whatsapp`]);
    const sealed = await t.p.evidence.get(u.id, s.id);
    assert.equal(sealed.externalCopies[0]!.provider, "fake-archive");
    assert.equal((await t.p.evidence.verify(u.id, s.id)).ok, true);
  });

  test("si la autoridad de sellado falla, la copia pública queda y el sello se reintenta", async () => {
    const { t, tsa, archive, u } = await evidencePlatform();
    tsa.fail = true;
    const { snapshot: s } = await t.p.evidence.capture({ actorId: u.id, url: NOTE });
    await assert.rejects(t.p.evidence.seal(s.id), /caída/);
    assert.equal((await t.p.evidence.get(u.id, s.id)).externalCopies.length, 1);
    tsa.fail = false;
    await t.p.evidence.seal(s.id);
    assert.ok((await t.p.evidence.get(u.id, s.id)).timestamp);
    assert.equal(archive.archived.length, 1, "no se vuelve a pedir la copia pública");
  });

  test("seguimiento: sin cambios no crea otra captura; una edición silenciosa y un borrado quedan registrados", async () => {
    const { t, pages, u } = await evidencePlatform();
    const { snapshot: first } = await t.p.evidence.capture({ actorId: u.id, url: NOTE, monitor: true });
    assert.ok(first.monitorUntil);

    t.clock.advance(25 * 3_600_000);
    assert.deepEqual(await t.p.evidence.recheckDue(), { checked: 1, changed: 0 });
    assert.equal((await t.p.evidence.history(u.id, NOTE)).length, 1);
    assert.ok((await t.p.evidence.get(u.id, first.id)).lastCheckedAt);

    t.clock.advance(1 * 3_600_000);
    assert.deepEqual(await t.p.evidence.recheckDue(), { checked: 0, changed: 0 }, "todavía no pasaron 24 h desde la última mirada");

    pages.set(NOTE, "Suben las tarifas", ["El gas aumenta 45% en marzo.", "Lo anunció el ministro Pérez."]);
    t.clock.advance(24 * 3_600_000);
    assert.deepEqual(await t.p.evidence.recheckDue(), { checked: 1, changed: 1 });
    const [, edited] = await t.p.evidence.history(u.id, NOTE);
    assert.equal(edited!.reason, "recheck");
    assert.deepEqual(edited!.change, { added: ["El gas aumenta 45% en marzo."], removed: ["El gas aumenta 30% en marzo."] });
    assert.equal(edited!.previousRecordHash, first.recordHash);
    assert.equal((await t.p.evidence.get(u.id, first.id)).supersededBy, edited!.id);

    pages.pages.delete(NOTE);
    t.clock.advance(24 * 3_600_000);
    await t.p.evidence.recheckDue();
    const gone = (await t.p.evidence.history(u.id, NOTE)).at(-1)!;
    assert.equal(gone.status, "gone");
    assert.equal(gone.httpStatus, 404);

    const events = (await t.store.repos.audit.find({})).map((e) => e.action);
    assert.ok(events.includes("evidence.changed") && events.includes("evidence.gone"));

    // Pasado el plazo de seguimiento, no se mira más.
    t.clock.advance(40 * 86_400_000);
    assert.equal((await t.p.evidence.recheckDue()).checked, 0);
  });

  test("alteraciones: tocar un registro viejo o un archivo guardado se detecta", async () => {
    const { t, pages, u } = await evidencePlatform();
    const { snapshot: a } = await t.p.evidence.capture({ actorId: u.id, url: NOTE });
    pages.set(NOTE, "Suben las tarifas", ["Otro texto."]);
    const { snapshot: b } = await t.p.evidence.capture({ actorId: u.id, url: NOTE });
    await t.p.evidence.seal(a.id);
    await t.p.evidence.seal(b.id);
    assert.equal((await t.p.evidence.verify(u.id, b.id)).ok, true);

    await t.store.repos.evidence.save({ ...(await t.store.repos.evidence.findById(a.id))!, title: "Título cambiado a mano" });
    const v = await t.p.evidence.verify(u.id, b.id);
    assert.equal(v.ok, false);
    assert.match(v.checks.find((c) => c.name === "Cadena de capturas anteriores")!.detail!, new RegExp(a.id));

    const rawKey = b.blobs.find((x) => x.kind === "raw")!.key;
    await t.store.repos.evidenceBlobs.put({ key: rawKey, mime: "text/html", dataBase64: Buffer.from("<p>falsa</p>").toString("base64") });
    assert.equal((await t.p.evidence.verify(u.id, b.id)).checks.find((c) => c.name === "Archivo original")!.ok, false);
  });

  test("permisos, plan, tope diario y direcciones prohibidas", async () => {
    const { t, u } = await evidencePlatform();
    const free = await userWithPlan(t, "gratis");
    await assert.rejects(t.p.evidence.capture({ actorId: free.id, url: NOTE }), (e: unknown) => e instanceof AccessDeniedError && e.code === "feature_not_in_plan");

    const { snapshot: s } = await t.p.evidence.capture({ actorId: u.id, url: NOTE });
    const other = await userWithPlan(t, "profesional");
    await assert.rejects(t.p.evidence.get(other.id, s.id), NotFoundError);
    assert.deepEqual(await t.p.evidence.history(other.id, NOTE), []);
    const checker = await withRoles(t, other.id, ["fact_checker"]);
    assert.equal((await t.p.evidence.get(checker.id, s.id)).id, s.id);

    const a = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    await t.p.config.params.set({ actorId: a.id, key: "evidence.max_per_day", value: 1, reason: "Prueba del tope diario" });
    await assert.rejects(t.p.evidence.capture({ actorId: u.id, url: NOTE }), (e: unknown) => e instanceof AccessDeniedError && e.code === "quota_exceeded");

    // Con la descarga real (HTTP), una dirección interna se rechaza y no queda registrada.
    const real = await testPlatform();
    const pro = await userWithPlan(real, "profesional");
    await assert.rejects(real.p.evidence.capture({ actorId: pro.id, url: "http://169.254.169.254/latest/meta-data/" }), /no es una página pública/);
    assert.deepEqual(await real.p.evidence.listMine(pro.id), []);
  });
});

describe("Evidencias: datos personales", () => {
  test("se exportan; al borrar la cuenta quedan las copias sin dueño, sin seguimiento y con la cadena intacta", async () => {
    const { t, pages, u } = await evidencePlatform();
    const { snapshot: a } = await t.p.evidence.capture({ actorId: u.id, url: NOTE, monitor: true });
    pages.set(NOTE, "Suben las tarifas", ["Texto editado."]);
    t.clock.advance(25 * 3_600_000);
    await t.p.evidence.recheckDue();
    const exported = (await t.p.privacy.personalData.exportMyData(u.id)) as { archivedPages: { id: string }[] };
    assert.deepEqual(exported.archivedPages.map((e) => e.id), [a.id]);

    await t.p.privacy.personalData.deleteMyData({ userId: u.id, confirmation: "BORRAR MIS DATOS" });
    const all = await t.store.repos.evidence.findByUrlKey(NOTE);
    assert.equal(all.length, 2);
    assert.ok(all.every((e) => e.requestedBy !== u.id && e.subjectId !== u.id && !e.monitorUntil));
    const checker = await withRoles(t, (await userWithPlan(t, "profesional")).id, ["fact_checker"]);
    const v = await t.p.evidence.verify(checker.id, all[1]!.id);
    assert.equal(v.checks.find((c) => c.name === "Cadena de capturas anteriores")!.ok, true);
    assert.equal(v.checks.find((c) => c.name === "Huella del registro")!.ok, true);
  });
});

describe("Evidencias: chat y API", () => {
  test("/guardar <link> seguir", async () => {
    const { t } = await evidencePlatform();
    const from = "+5491133330001";
    await userWithPlan(t, "profesional", ["reader"], from);
    const r = await t.p.inbound.execute(wa(from, `/guardar ${NOTE} seguir`, t.clock.now()));
    assert.equal(r.response.title, "Guardé una copia de la nota");
    const lines = r.response.sections[0]!.lines.join("\n");
    assert.match(lines, /Huella \(SHA-256\): [0-9a-f]{16}…/);
    assert.match(lines, /La vuelvo a mirar hasta el/);
    t.clock.advance(60_000);
    const empty = await t.p.inbound.execute(wa(from, "/guardar", t.clock.now()));
    assert.match(empty.response.summary!, /Mandame \/guardar y el link/);
  });

  test("API: capturar, historial, verificar y descargar como adjunto (nunca como página)", async () => {
    const { t, u } = await evidencePlatform();
    const key = (await t.p.integrations.apiKeys.create({ actorId: u.id, name: "bot", scopes: ["content:analyze"] })).plaintext;
    const server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = { authorization: `Bearer ${key}` };
    try {
      const created = await fetch(`${base}/v1/evidence`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ url: NOTE, monitor: true }) });
      assert.equal(created.status, 201);
      const s = (await created.json()) as { id: string };
      const hist = (await (await fetch(`${base}/v1/evidence?url=${encodeURIComponent(NOTE)}`, { headers: auth })).json()) as unknown[];
      assert.equal(hist.length, 1);
      const v = (await (await fetch(`${base}/v1/evidence/${s.id}/verify`, { headers: auth })).json()) as { checks: { name: string }[] };
      assert.ok(v.checks.some((c) => c.name === "Huella del registro"));
      const file = await fetch(`${base}/v1/evidence/${s.id}/content`, { headers: auth });
      assert.equal(file.headers.get("content-type"), "application/octet-stream");
      assert.match(file.headers.get("content-disposition")!, /^attachment;/);
      assert.equal(file.headers.get("x-content-type-options"), "nosniff");
      assert.match(await file.text(), /<title>Suben las tarifas<\/title>/);
      assert.equal((await fetch(`${base}/v1/evidence/no-existe`, { headers: auth })).status, 404);
    } finally {
      server.close();
    }
  });
});

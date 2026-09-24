/** Grupo 2: cola de trabajos, verificación, facturación, datos personales, costos, caché y métricas. */
import assert from "node:assert/strict";
import { SCHEDULES } from "../src/config/catalog";
import { describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { JobWorker, PersistentJobQueue } from "../src/application/jobs/Jobs";
import { ConflictError, ValidationError } from "../src/domain/errors";
import { invoiceLetter, isValidCuit, splitVat } from "../src/domain/rules/invoiceRules";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { MeteredLLMClient, PrometheusMetrics } from "../src/infrastructure/observability/Observability";
import { SilentLogger } from "../src/infrastructure/system/System";
import { testPlatform, userWithPlan, wa, withRoles, type Handler } from "./helpers/platform";
import type { AddressInfo } from "node:net";

const march = { from: new Date("2026-03-01T03:00:00Z"), to: new Date("2026-04-01T02:59:59Z") };

describe("Cola de trabajos", () => {
  test("dos servidores compiten por los mismos trabajos: cada uno corre una sola vez", async () => {
    const t = await testPlatform();
    const queue = new PersistentJobQueue(t.store.repos.jobs, t.clock);
    for (let i = 0; i < 12; i++) await queue.enqueue("contar", { i });
    const seen: number[] = [];
    const handlers = { contar: async (p: Record<string, unknown>) => void seen.push(Number(p.i)) };
    const a = new JobWorker(t.store.repos.jobs, handlers, t.clock, new SilentLogger(), { workerId: "A", batchSize: 12 });
    const b = new JobWorker(t.store.repos.jobs, handlers, t.clock, new SilentLogger(), { workerId: "B", batchSize: 12 });
    await Promise.all([a.runOnce(), b.runOnce(), a.runOnce(), b.runOnce()]);
    assert.deepEqual([...seen].sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test("reintento con espera creciente, luego cola muerta; tipo desconocido muere enseguida; deduplicación", async () => {
    const t = await testPlatform();
    const queue = new PersistentJobQueue(t.store.repos.jobs, t.clock);
    const job = (await queue.enqueue("fallar", {}, { maxAttempts: 3, dedupeKey: "unico" }))!;
    assert.equal(await queue.enqueue("fallar", {}, { dedupeKey: "unico" }), undefined);
    await queue.enqueue("desconocido", {});
    const worker = new JobWorker(t.store.repos.jobs, { fallar: async () => { throw new Error("se cayó el proveedor"); } }, t.clock, new SilentLogger(), { backoffBaseMs: 60_000 });

    assert.deepEqual(await worker.runOnce(), { ran: 2, failed: 1, dead: 1 });
    assert.equal((await worker.runOnce()).ran, 0, "espera 1 minuto antes de reintentar");
    t.clock.advance(61_000);
    await worker.runOnce();
    t.clock.advance(121_000);
    await worker.runOnce();
    const final = (await t.store.repos.jobs.findById(job.id))!;
    assert.equal(final.status, "dead");
    assert.equal(final.attempts, 3);
    assert.equal(final.lastError, "se cayó el proveedor");
  });

  test("un servidor que se cae: su trabajo se retoma cuando vence la reserva", async () => {
    const t = await testPlatform();
    const queue = new PersistentJobQueue(t.store.repos.jobs, t.clock);
    const job = (await queue.enqueue("x", {}))!;
    await t.store.repos.jobs.replaceIf({ ...job, status: "running", lockedBy: "caido", lockedUntil: new Date(t.clock.now().getTime() + 60_000) }, { status: "queued", lockedBy: null });
    let ran = 0;
    const w = new JobWorker(t.store.repos.jobs, { x: async () => void ran++ }, t.clock, new SilentLogger());
    await w.runOnce();
    assert.equal(ran, 0);
    t.clock.advance(61_000);
    await w.runOnce();
    assert.equal(ran, 1);
  });

  test("el planificador genera una tarea por franja aunque corra en varios servidores", async () => {
    const t = await testPlatform();
    const first = await t.p.jobs.scheduler.tick();
    assert.equal(first, SCHEDULES.length, "una por cada trabajo periódico");
    assert.equal(await t.p.jobs.scheduler.tick(), 0, "mismo momento: nada nuevo");
    t.clock.advance(15 * 60_000);
    assert.equal(await t.p.jobs.scheduler.tick(), 2, "a los 15 min: sólo las de cada 15 min");
    // El worker toma de a tandas: se corre hasta vaciar la cola.
    let ran = 0;
    for (let i = 0; i < 5; i++) {
      const r = await t.p.jobs.worker().runOnce();
      assert.equal(r.dead, 0);
      ran += r.ran;
    }
    assert.equal(ran, SCHEDULES.length + 2);
  });
});

describe("Verificación de datos", () => {
  const series: Handler = (_m, url) =>
    url.startsWith("https://apis.datos.gob.ar/series/api/series/")
      ? { status: 200, text: JSON.stringify({ data: [["2026-03-01", 30]], meta: [] }) }
      : { status: 404 };

  test("un dato en disputa se vuelve tarea (sin duplicar); fuentes primarias sugieren evidencia; resolver exige evidencia y corrige la exactitud", async () => {
    const t = await testPlatform({ http: series, extra: { statisticsCatalog: [{ keywords: ["tarifas de gas"], seriesId: "tarifa.gas.aumento", label: "Aumento de la tarifa de gas", unit: "%" }] } });
    const pro = await userWithPlan(t, "profesional");
    await t.p.gateway.compareSources({ userId: pro.id, channel: "web" }, { topic: "tarifas de gas", period: march });
    await t.p.gateway.compareSources({ userId: pro.id, channel: "web" }, { topic: "tarifas de gas", period: march });
    const checker = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["fact_checker"]);
    const [task, ...rest] = await t.p.verification.queue(checker.id);
    assert.ok(task && rest.length === 0, "una sola tarea aunque se compare dos veces");
    assert.ok(task.claimIds.length >= 2);

    const rep = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["fact_checker"]);
    rep.representsOutletIds = ["lvc"];
    await t.store.repos.users.save(rep);
    await assert.rejects(t.p.verification.take(rep.id, task.id), /Representás/);

    await t.p.verification.take(checker.id, task.id);
    await t.p.verification.uploadDocument(checker.id, {
      title: "Resolución 45", issuer: "Ente regulador", url: "https://boletin.example/res-45", publishedAt: new Date("2026-03-09"),
      text: "Artículo 1. Apruébase un aumento de 30% en las tarifas de gas a partir de abril.", topics: ["tarifas de gas"],
    });
    const withEvidence = await t.p.verification.suggestEvidence(checker.id, task.id);
    const sources = withEvidence.evidence.map((e) => e.source);
    assert.ok(sources.some((s) => s.includes("Documentos oficiales")));
    assert.ok(sources.some((s) => s.includes("datos.gob.ar")));

    const claims = await t.store.repos.claims.findByArticleIds((await t.store.repos.articles.find({ topic: "tarifas de gas" })).map((a) => a.id));
    const verdicts = Object.fromEntries(task.claimIds.map((id) => [id, claims.find((c) => c.id === id)!.text.includes("18%") ? "refuted" : "confirmed"])) as Record<string, "refuted" | "confirmed">;
    await assert.rejects(t.p.verification.resolve({ actorId: checker.id, taskId: task.id, verdicts, note: "corta" }), ValidationError);
    const done = await t.p.verification.resolve({ actorId: checker.id, taskId: task.id, verdicts, note: "La resolución 45 fija el aumento en 30%; la cifra de 18% es incorrecta." });
    assert.equal(done.status, "resolved");

    const lvc = await t.p.gateway.evaluateCredibility({ userId: pro.id, channel: "web" }, { outletId: "lvc", topic: "tarifas de gas", period: march });
    assert.equal(lvc.dimensions.find((d) => d.dimensionId === "accuracy")!.score, 0, "La Voz Capital dio la cifra desmentida");
  });
});

describe("Facturación", () => {
  test("reglas fiscales", () => {
    assert.equal(invoiceLetter("responsable_inscripto", "responsable_inscripto"), "A");
    assert.equal(invoiceLetter("responsable_inscripto", "monotributista"), "A");
    assert.equal(invoiceLetter("responsable_inscripto", "consumidor_final"), "B");
    assert.equal(invoiceLetter("monotributista", "responsable_inscripto"), "C");
    assert.deepEqual(splitVat(12_100, "A", 0.21), { net: 10_000, vat: 2_100 });
    assert.deepEqual(splitVat(12_100, "C", 0.21), { net: 12_100, vat: 0 });
    assert.equal(isValidCuit("20-12345678-6"), true);
    assert.equal(isValidCuit("20-12345678-0"), false);
  });

  test("pago confirmado → trabajo → factura (A con CUIT de responsable inscripto, B sin datos); si ARCA falla se reintenta; nunca se duplica", async () => {
    const t = await testPlatform();
    const empresa = await userWithPlan(t, "gratis");
    await assert.rejects(t.p.billing.setProfile.execute({ actorId: empresa.id, legalName: "Consultora SA", taxIdType: "CUIT", taxId: "20-12345678-0", taxCondition: "responsable_inscripto" }), /CUIT válido/);
    await t.p.billing.setProfile.execute({ actorId: empresa.id, legalName: "Consultora SA", taxIdType: "CUIT", taxId: "20-12345678-6", taxCondition: "responsable_inscripto" });
    const persona = await userWithPlan(t, "gratis");

    t.invoiceIssuer.failNext = 1;
    for (const u of [empresa, persona]) {
      const { subscription } = await t.p.users.changePlan.execute({ actorId: u.id, planId: "personal" });
      await t.p.users.confirmPayment.execute({ subscriptionId: subscription.id });
      await t.p.users.confirmPayment.execute({ subscriptionId: subscription.id }); // aviso duplicado del proveedor
    }
    const worker = t.p.jobs.worker();
    await worker.runOnce();
    t.clock.advance(2 * 60_000);
    await worker.runOnce();

    const [a] = await t.store.repos.invoices.findBySubject({ type: "user", id: empresa.id });
    const [b] = await t.store.repos.invoices.findBySubject({ type: "user", id: persona.id });
    assert.equal(a!.letter, "A");
    assert.equal(a!.status, "issued");
    assert.equal(a!.net + a!.vat, 4_990);
    assert.equal(b!.letter, "B");
    assert.equal(b!.buyer.name, "Consumidor Final");
    assert.equal(t.invoiceIssuer.issued.length, 2, "una factura por cobro, aunque el aviso llegue dos veces y ARCA haya fallado una");
  });
});

describe("Datos personales", () => {
  test("exportar todo (sin secretos) y borrar: se anonimiza, se libera el número, se conservan facturas", async () => {
    const t = await testPlatform();
    const from = "+5491188888888";
    const { user } = await t.p.inbound.execute(wa(from, "Es un logro histórico: la inflación bajó a 2%.", t.clock.now()));
    await t.p.reviews.submit({ userId: user.id, target: { type: "platform", id: "sin-humo" }, rating: 5 });
    const { subscription } = await t.p.users.changePlan.execute({ actorId: user.id, planId: "profesional" });
    await t.p.users.confirmPayment.execute({ subscriptionId: subscription.id });
    await t.p.jobs.worker().runOnce();
    const { plaintext } = await t.p.integrations.apiKeys.create({ actorId: user.id, name: "bot", scopes: ["smoke:analyze"] });

    const data = await t.p.privacy.personalData.exportMyData(user.id);
    const json = JSON.stringify(data);
    assert.equal((data.analyses as unknown[]).length, 1);
    assert.equal((data.invoices as unknown[]).length, 1);
    assert.ok(json.includes(from));
    assert.ok(!json.includes(plaintext) && !json.includes('"hash"'), "no exporta claves ni hashes");

    await assert.rejects(t.p.privacy.personalData.deleteMyData({ userId: user.id, confirmation: "si" }), ValidationError);
    await t.p.privacy.personalData.deleteMyData({ userId: user.id, confirmation: "BORRAR MIS DATOS" });
    const gone = (await t.store.repos.users.findById(user.id))!;
    assert.equal(gone.status, "deleted");
    assert.equal(gone.channels.length, 0);
    assert.equal((await t.store.repos.contentAnalyses.findByUser(user.id, 10)).length, 0);
    assert.equal((await t.store.repos.reviews.findByAuthor(user.id)).length, 0);
    assert.equal((await t.store.repos.invoices.findBySubject({ type: "user", id: user.id })).length, 1, "las facturas se conservan");
    await assert.rejects(t.p.integrations.apiKeys.authenticate(plaintext));
    const again = await t.p.inbound.execute(wa(from, "hola", t.clock.now()));
    assert.notEqual(again.user.id, user.id, "el número quedó libre: es una cuenta nueva");
  });

  test("el único admin de una organización con miembros no puede borrarse sin designar a otro", async () => {
    const t = await testPlatform();
    const admin = await userWithPlan(t, "gratis");
    const org = await t.p.users.createOrganization.execute({ ownerId: admin.id, name: "Org" });
    const m = await userWithPlan(t, "gratis");
    m.organizationId = org.id;
    await t.store.repos.users.save(m);
    await assert.rejects(t.p.privacy.personalData.deleteMyData({ userId: admin.id, confirmation: "BORRAR MIS DATOS" }), ConflictError);
  });

  test("retención: los análisis viejos se borran solos", async () => {
    const t = await testPlatform();
    const { user } = await t.p.inbound.execute(wa("+5491199999999", "Sube 10%.", t.clock.now()));
    t.clock.advance(400 * 86_400_000);
    await t.p.privacy.retention.execute();
    assert.equal((await t.store.repos.contentAnalyses.findByUser(user.id, 10)).length, 0);
  });
});

describe("Costos, caché y métricas", () => {
  test("cada mensaje y cada llamada a la IA se atribuye al cliente; el reporte muestra margen y quién se pasa", async () => {
    const t = await testPlatform();
    const { user } = await t.p.inbound.execute(wa("+5491177770000", "hola", t.clock.now()));
    const fakeLlm = { completeJSON: async () => ({ data: {}, usage: { model: "default", inputTokens: 100_000, outputTokens: 20_000 } }) };
    const metered = new MeteredLLMClient(fakeLlm as never, t.p.costs.tracker);
    await t.p.requestContext.run({ userId: user.id, subjectId: user.id, action: "prueba" }, () => metered.completeJSON({ system: "", user: "" }));

    const admin = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    const report = await t.p.costs.report.execute({ actorId: admin.id, from: new Date("2026-09-01"), to: t.clock.now() });
    const mine = report.bySubject.find((s) => s.subjectId === user.id)!;
    assert.ok(report.byProvider.whatsapp! > 0, "la respuesta por WhatsApp se contó");
    assert.equal(mine.costUsd, 0.61, "0,6 USD de IA + 0,01 del mensaje");
    assert.equal(mine.overBudget, true, "plan gratis por encima del tope mensual");
    await assert.rejects(t.p.costs.report.execute({ actorId: user.id, from: new Date("2026-09-01"), to: t.clock.now() }), /administración/);
  });

  test("la misma cadena reenviada muchas veces se analiza una sola vez", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "personal");
    const text = "URGENTE: según fuentes cercanas sube 300% el gas. Reenviá a todos.";
    await t.p.gateway.analyzeSmoke({ userId: u.id, channel: "web" }, text);
    await t.p.gateway.analyzeSmoke({ userId: u.id, channel: "web" }, `  ${text.toLowerCase()} `);
    const m = t.p.metrics as PrometheusMetrics;
    assert.equal(m.value("sinhumo_cache_total", { cache: "smoke", result: "hit" }), 1);
    assert.equal(m.value("sinhumo_requests_total", { action: "analyze_smoke", channel: "web", outcome: "ok" }), 2);
  });

  test("/metrics en formato Prometheus, sólo con token", async () => {
    const t = await testPlatform();
    const server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" }, metricsToken: "tok" }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await t.p.inbound.execute(wa("+5491166660000", "hola", t.clock.now()));
    try {
      assert.equal((await fetch(`${base}/metrics`)).status, 403);
      const text = await (await fetch(`${base}/metrics`, { headers: { authorization: "Bearer tok" } })).text();
      assert.match(text, /sinhumo_cost_usd_total\{provider="whatsapp"\}/);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

/** 4C: estadísticas (panel, observatorio anonimizado, negocio) y exportación (Excel, reportes programados, datos abiertos, BI). */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import ExcelJS from "exceljs";
import { httpApiDeps } from "../src/composition/platform";
import { nextRun, previousPeriod } from "../src/application/exports/ScheduledReports";
import { statDay } from "../src/application/stats/Stats";
import { AccessDeniedError, ValidationError } from "../src/domain/errors";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { KAnonymizer, RecordingProductAnalytics } from "../src/infrastructure/stats/StatsAdapters";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

type T = Awaited<ReturnType<typeof testPlatform>>;

const CHAIN = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario.";
const HYPE = "Es un logro histórico, sin precedentes, el mejor plan de la historia que va a cambiar todo.";
const CLEAN = "El INDEC informó que la inflación de agosto fue de 2,1% mensual, según el informe publicado el 12 de septiembre.";
const MARCH = { from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-03-31T23:00:00Z") };

const today = (t: T) => ({ from: new Date(t.clock.now().getTime() - 86_400_000), to: t.clock.now() });

async function withEmail(t: T, userId: string, address: string) {
  const u = (await t.store.repos.users.findById(userId))!;
  u.channels.push({ channel: "email", address, verified: true, linkedAt: t.clock.now() });
  await t.store.repos.users.save(u);
  return u;
}

async function orgOnPlan(t: T, planId: string) {
  const admin = await userWithPlan(t, "gratis");
  const org = await t.p.users.createOrganization.execute({ ownerId: admin.id, name: "Redacción Norte" });
  const cur = await t.store.repos.subscriptions.findCurrent({ type: "organization", id: org.id });
  if (cur) await t.store.repos.subscriptions.save({ ...cur, status: "replaced", endedAt: t.clock.now() });
  await t.store.repos.subscriptions.save({ id: `sub-org-${org.id}`, subject: { type: "organization", id: org.id }, planId, status: "active", currentPeriodEnd: new Date("2027-12-31"), createdAt: new Date(t.clock.now().getTime() + 1) });
  const member = async (roleId = "reader") => {
    const u = await userWithPlan(t, "gratis");
    u.organizationId = org.id;
    await t.store.repos.users.save(u);
    await t.p.users.roles.assign({ actorId: admin.id, targetId: u.id, roleId });
    return (await t.store.repos.users.findById(u.id))!;
  };
  return { admin: (await t.store.repos.users.findById(admin.id))!, org, member };
}

describe("Panel de uso", () => {
  test("cuenta análisis, humo por tipo, canales y temas, día por día", async () => {
    const t = await testPlatform();
    const from = "+5491188880001";
    await t.p.inbound.execute(wa(from, CHAIN, t.clock.now()));
    t.clock.advance(60_000);
    await t.p.inbound.execute(wa(from, HYPE, t.clock.now()));
    t.clock.advance(60_000);
    await t.p.inbound.execute(wa(from, CLEAN, t.clock.now()));
    const u = (await t.store.repos.users.findByChannel("whatsapp", from))!;
    await t.p.gateway.compareSources({ userId: u.id, channel: "web" }, { topic: "tarifas de gas", period: MARCH });

    const p = await t.p.stats.service.panel({ actorId: u.id, scope: "user", period: today(t) });
    assert.deepEqual(p.totals, { analyses: 3, withSmoke: 2, smokeRate: 0.67, comparisons: 1 });
    assert.equal(p.daily.at(-1)!.day, statDay(t.clock.now()));
    assert.equal(p.daily.at(-1)!.analyses, 3);
    assert.ok(p.smokeTypes.some((x) => x.type === "chain_call"));
    assert.ok(p.smokeTypes.some((x) => x.type === "inflated_adjective"));
    assert.deepEqual(p.channels, [{ channel: "whatsapp", count: 3 }]);
    assert.deepEqual(p.topics, [{ topic: "tarifas de gas", count: 1 }]);
  });

  test("organización: con permiso ve el total y los miembros activos; un lector no", async () => {
    const t = await testPlatform();
    const { admin, member } = await orgOnPlan(t, "equipo");
    const a = await member();
    const b = await member();
    await member(); // no usa nada
    await t.p.gateway.analyzeSmoke({ userId: a.id, channel: "web" }, HYPE);
    await t.p.gateway.analyzeSmoke({ userId: b.id, channel: "telegram" }, CLEAN);

    const p = await t.p.stats.service.panel({ actorId: admin.id, scope: "organization", period: today(t) });
    assert.equal(p.totals.analyses, 2);
    assert.equal(p.activeMembers, 2);
    assert.deepEqual(p.channels.map((c) => c.channel).sort(), ["telegram", "web"]);
    await assert.rejects(t.p.stats.service.panel({ actorId: a.id, scope: "organization", period: today(t) }), AccessDeniedError);
    await assert.rejects(t.p.stats.service.panel({ actorId: a.id, scope: "user", period: { from: new Date("2024-01-01"), to: t.clock.now() } }), ValidationError);
  });
});

describe("Observatorio público (anonimizado)", () => {
  test("un grupo sólo se publica con al menos k personas distintas; los números se redondean", async () => {
    const t = await testPlatform({ extra: { stats: { minGroupSize: 3, rounding: 5 } } });
    const month = statDay(t.clock.now()).slice(0, 7);
    // La misma persona muchas veces NO alcanza.
    for (let i = 0; i < 4; i++) {
      await t.p.inbound.execute(wa("+5491100000100", `${CHAIN} (${i})`, t.clock.now()));
      t.clock.advance(60_000);
    }
    let r = await t.p.stats.service.observatory(month);
    assert.equal(r.totals.analyses, 0);
    assert.equal(r.smokeTypes.length, 0);
    assert.ok(r.suppressedGroups > 0);

    for (const n of ["+5491100000101", "+5491100000102"]) {
      await t.p.inbound.execute(wa(n, CHAIN, t.clock.now()));
      t.clock.advance(60_000);
    }
    r = await t.p.stats.service.observatory(month);
    assert.equal(r.totals.analyses, 5, "6 análisis de 3 personas → redondeado de a 5");
    assert.ok(r.smokeTypes.find((x) => x.type === "chain_call"));
    assert.equal(r.minGroupSize, 3);
    assert.match(r.methodology, /3 personas distintas/);
    assert.ok(r.narratives.length >= 1, "la cadena aparece como narrativa (texto redactado)");
    assert.ok(!JSON.stringify(r).includes("+549110000010"), "ningún teléfono");
  });

  test("seudónimos irreversibles y estables", () => {
    const a = new KAnonymizer("una-clave-secreta-larga", 10, 5);
    assert.equal(a.pseudonym("user_1"), a.pseudonym("user_1"));
    assert.notEqual(a.pseudonym("user_1"), new KAnonymizer("otra-clave-secreta-larga").pseudonym("user_1"));
    assert.ok(!a.pseudonym("user_1").includes("user"));
    assert.equal(a.publish(100, 9), null);
    assert.equal(a.publish(12, 10), 10);
    assert.equal(a.publish(11, 11), 10);
    assert.throws(() => new KAnonymizer("corta"));
  });
});

describe("Métricas del negocio", () => {
  test("MRR, clientes, altas, bajas, ARPU y registros; sólo para el equipo de la plataforma", async () => {
    const t = await testPlatform({ now: "2026-08-01T12:00:00Z" });
    const admin = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    const pay = async (userId: string, planId: string) => {
      const { subscription } = await t.p.users.changePlan.execute({ actorId: userId, planId });
      if (subscription.status === "pending_payment") await t.p.users.confirmPayment.execute({ subscriptionId: subscription.id });
    };
    const a = await userWithPlan(t, "gratis");
    const c = await userWithPlan(t, "gratis");
    t.clock.advance(1000);
    await pay(a.id, "personal");
    await pay(c.id, "profesional");

    const from = new Date("2026-08-10T00:00:00Z");
    t.clock.set(new Date("2026-08-15T12:00:00Z"));
    const b = await t.p.users.register.execute({ name: "Bea", channel: { type: "telegram", address: "777", verified: true } });
    t.clock.advance(1000);
    await pay(b.id, "personal");
    await pay(c.id, "gratis"); // baja a gratis = baja de cliente pago
    const to = new Date("2026-08-31T23:00:00Z");

    const k = await t.p.stats.service.business({ actorId: admin.id, period: { from, to } });
    assert.equal(k.payingAtStart, 2);
    assert.equal(k.mrrAtStart, 4_990 + 14_990);
    assert.equal(k.payingSubjects, 2);
    assert.equal(k.mrr, 4_990 * 2);
    assert.equal(k.newPaying, 1);
    assert.equal(k.churned, 1);
    assert.equal(k.churnRate, 0.5);
    assert.equal(k.arpu, 4_990);
    assert.equal(k.registrations, 1);
    assert.deepEqual(k.byPlan, [{ planId: "personal", subjects: 2, mrr: 9_980 }]);

    await assert.rejects(t.p.stats.service.business({ actorId: a.id, period: { from, to } }), AccessDeniedError);
  });
});

describe("Exportar a Excel", () => {
  test("hoja de resumen + una hoja por tabla, con números como números", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "profesional");
    await t.p.gateway.analyzeSmoke({ userId: u.id, channel: "web" }, HYPE);
    const file = await t.p.exports.export({ userId: u.id, channel: "web" }, { kind: "usage_panel", scope: "user", period: today(t) }, "xlsx");
    assert.match(file.filename, /\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.data as unknown as ArrayBuffer);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ["Resumen", "Por día", "Tipos de humo", "Canales", "Temas comparados"]);
    const byDay = wb.getWorksheet("Por día")!;
    assert.equal(byDay.getRow(1).getCell(2).value, "Análisis");
    assert.equal(byDay.getRow(byDay.rowCount).getCell(2).value, 1, "número, no texto");
    assert.equal(wb.getWorksheet("Resumen")!.getCell("A1").value, "Tu uso de Sin Humo");
  });
});

describe("Reportes programados por mail", () => {
  test("sólo a mails verificados, prueba al crear, se envía con adjunto y se pausa si se pierde el plan", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "profesional");
    await withEmail(t, u.id, "ana@ejemplo.com");
    await t.p.gateway.analyzeSmoke({ userId: u.id, channel: "web" }, CHAIN);

    await assert.rejects(
      t.p.stats.scheduledReports.create({ actorId: u.id, name: "x", kind: "usage_panel", format: "xlsx", frequency: "weekly", recipients: ["desconocido@spam.com"] }),
      ValidationError,
    );
    await assert.rejects(
      t.p.stats.scheduledReports.create({ actorId: u.id, name: "x", kind: "business_kpis", format: "xlsx", frequency: "weekly", recipients: ["ana@ejemplo.com"] }),
      AccessDeniedError,
      "la prueba al crear detecta que no tiene permiso para ese reporte",
    );
    const free = await userWithPlan(t, "gratis");
    await withEmail(t, free.id, "libre@ejemplo.com");
    await assert.rejects(
      t.p.stats.scheduledReports.create({ actorId: free.id, name: "x", kind: "usage_panel", format: "pdf", frequency: "weekly", recipients: ["libre@ejemplo.com"] }),
      AccessDeniedError,
    );

    const s = await t.p.stats.scheduledReports.create({ actorId: u.id, name: "Mi semana", kind: "usage_panel", scope: "user", format: "xlsx", frequency: "weekly", recipients: ["ANA@ejemplo.com"] });
    assert.equal(s.nextRunAt.getUTCDay(), 1, "lunes");
    assert.equal(s.nextRunAt.getUTCHours(), 11, "8 de la mañana en Argentina");

    t.clock.set(new Date(s.nextRunAt.getTime() + 60_000));
    await t.p.jobs.scheduler.tick();
    // El worker toma de a tandas (hay más tareas periódicas que el tamaño de la tanda): hasta vaciar.
    for (let i = 0; i < 5 && (await t.p.jobs.worker().runOnce()).ran > 0; i++);
    const mail = t.mail.sent.find((m) => m.to === "ana@ejemplo.com");
    assert.ok(mail, "llegó el mail");
    assert.equal(mail.subject, "Sin Humo · Mi semana");
    assert.match(mail.attachments![0]!.filename, /\.xlsx$/);
    assert.match(mail.text, /BAJA/);
    const after = (await t.store.repos.reportSchedules.findById(s.id))!;
    assert.equal(after.nextRunAt.getTime(), s.nextRunAt.getTime() + 7 * 86_400_000);

    // Pierde el plan: el próximo envío se pausa en vez de fallar para siempre.
    const cur = await t.store.repos.subscriptions.findCurrent({ type: "user", id: u.id });
    await t.store.repos.subscriptions.save({ ...cur!, status: "replaced", endedAt: t.clock.now() });
    await t.store.repos.subscriptions.save({ id: "sub-free", subject: { type: "user", id: u.id }, planId: "gratis", status: "active", currentPeriodEnd: new Date("2030-01-01"), createdAt: t.clock.now() });
    t.clock.set(new Date(after.nextRunAt.getTime() + 60_000));
    const r = await t.p.stats.scheduledReports.runDue();
    assert.deepEqual(r, { sent: 0, paused: 1, failed: 0 });
    assert.match((await t.store.repos.reportSchedules.findById(s.id))!.lastError!, /Exportar no está incluido/);
  });

  test("calendario: lunes a las 8 y el día 1; el mensual cubre el mes calendario anterior", () => {
    assert.equal(nextRun("weekly", new Date("2026-09-23T15:00:00Z")).toISOString(), "2026-09-28T11:00:00.000Z");
    assert.equal(nextRun("weekly", new Date("2026-09-28T10:00:00Z")).toISOString(), "2026-09-28T11:00:00.000Z");
    assert.equal(nextRun("monthly", new Date("2026-09-23T15:00:00Z")).toISOString(), "2026-10-01T11:00:00.000Z");
    const p = previousPeriod("monthly", new Date("2026-10-01T11:00:00Z"));
    assert.equal(p.from.toISOString(), "2026-09-01T03:00:00.000Z");
    assert.equal(p.to.toISOString(), "2026-10-01T02:59:59.999Z");
  });
});

describe("Datos abiertos y BI", () => {
  test("catálogo de datasets con licencia; pauta oficial en CSV y JSON por HTTP; observatorio público", async () => {
    const t = await testPlatform();
    const server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const list = (await (await fetch(`${base}/public/datasets`)).json()) as { id: string; license: string }[];
      assert.deepEqual(list.map((d) => d.id), ["humo-por-tipo", "cadenas-en-circulacion", "pauta-oficial"]);
      assert.match(list[0]!.license, /CC BY 4\.0/);

      const csv = await fetch(`${base}/public/datasets/pauta-oficial.csv?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z`);
      assert.equal(csv.headers.get("access-control-allow-origin"), "*");
      const text = await csv.text();
      assert.match(text.split("\r\n")[0]!, /^medio,pagador,jurisdiccion,desde,hasta,monto,moneda,fuente$/);
      assert.match(text, /El Diario del Valle,Gobierno de la Provincia del Valle,provincial,2026-01-01,2026-08-31,96000000,ARS,semilla/);

      const js = (await (await fetch(`${base}/public/datasets/pauta-oficial.json?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z`)).json()) as { rows: unknown[] };
      assert.ok(js.rows.length >= 2);
      assert.equal((await fetch(`${base}/public/datasets/no-existe.csv`)).status, 404);

      const obs = await fetch(`${base}/public/observatory?month=2026-09`);
      assert.equal(obs.status, 200);
      assert.equal((await fetch(`${base}/public/observatory?month=septiembre`)).status, 400);
    } finally {
      server.close();
    }
  });

  test("BI: filas planas e incrementales, sin textos; plan Empresa; lo de la organización con permiso", async () => {
    const t = await testPlatform();
    const { admin, member } = await orgOnPlan(t, "empresa");
    const a = await member();
    for (const text of [CHAIN, HYPE, CLEAN]) {
      await t.p.gateway.analyzeContent({ userId: a.id, channel: "web" }, {
        id: `c-${text.length}`, sourceType: "message", origin: {}, text, urls: [], publishedAt: t.clock.now(), receivedAt: t.clock.now(), attachments: [], metadata: {},
      });
      t.clock.advance(1000);
    }
    const page1 = await t.p.stats.biFeed.rows({ actorId: admin.id, dataset: "analyses", scope: "organization", since: new Date(0), limit: 2 });
    assert.equal(page1.rows.length, 2);
    assert.ok(page1.nextSince);
    assert.ok(!JSON.stringify(page1.rows).includes("URGENTE"), "sin el texto de los mensajes");
    assert.deepEqual(Object.keys(page1.rows[0]!), ["id", "fecha", "usuario", "origen", "dominio", "indice_humo", "tipos_humo", "links", "links_a_medios", "version_algoritmo"]);
    const page2 = await t.p.stats.biFeed.rows({ actorId: admin.id, dataset: "analyses", scope: "organization", since: new Date(page1.nextSince!), limit: 2 });
    assert.equal(page2.rows.length, 1);
    assert.equal(page2.nextSince, null);

    const daily = await t.p.stats.biFeed.rows({ actorId: admin.id, dataset: "daily_stats", scope: "organization", since: new Date(0) });
    assert.ok(daily.rows.some((r) => r.metrica === "analyses" && r.valor === 3));

    await assert.rejects(t.p.stats.biFeed.rows({ actorId: a.id, dataset: "analyses", scope: "organization", since: new Date(0) }), AccessDeniedError);
    // Una clave de API sin el alcance de estadísticas no alcanza, aunque el dueño lo tenga.
    await assert.rejects(t.p.stats.biFeed.rows({ actorId: admin.id, dataset: "analyses", scope: "organization", since: new Date(0), scopes: new Set(["smoke:analyze"]) }), AccessDeniedError);
    const pro = await userWithPlan(t, "profesional");
    await assert.rejects(t.p.stats.biFeed.rows({ actorId: pro.id, dataset: "analyses", scope: "user", since: new Date(0) }), /no está incluida/);
  });
});

describe("Analítica de producto y privacidad", () => {
  test("embudo registro → activación → pago con seudónimos; borrar la cuenta borra sus estadísticas", async () => {
    const analytics = new RecordingProductAnalytics();
    const t = await testPlatform({ extra: { productAnalytics: analytics } });
    await t.p.inbound.execute(wa("+5491166660001", CHAIN, t.clock.now()));
    t.clock.advance(60_000);
    await t.p.inbound.execute(wa("+5491166660001", HYPE, t.clock.now()));
    const u = (await t.store.repos.users.findByChannel("whatsapp", "+5491166660001"))!;
    const names = analytics.events.map((e) => e.event);
    assert.deepEqual(names.filter((n) => n !== "analysis_completed"), ["signed_up", "activated"], "se activa una sola vez");
    assert.ok(analytics.events.every((e) => e.distinctId !== u.id && !JSON.stringify(e).includes("+549")));

    assert.ok((await t.store.repos.stats.find({ scope: "user", scopeId: u.id, fromDay: "2000-01-01", toDay: "2100-01-01" })).length > 0);
    await t.p.privacy.personalData.deleteMyData({ userId: u.id, confirmation: "BORRAR MIS DATOS" });
    assert.equal((await t.store.repos.stats.find({ scope: "user", scopeId: u.id, fromDay: "0000", toDay: "zzzz" })).length, 0);
    const global = await t.store.repos.stats.find({ scope: "global", scopeId: "all", fromDay: "2000-01-01", toDay: "2100-01-01" });
    assert.ok(global.some((r) => r.metric === "analyses" && r.value === 2), "lo global (anónimo) se conserva");
  });
});

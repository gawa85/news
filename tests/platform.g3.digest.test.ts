/** 3.9: resumen diario o semanal. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { demoSeed } from "../src/demo/seedData";
import type { DigestSection } from "../src/domain/model";
import type { IDigestSource } from "../src/domain/ports";
import { digestDue, digestWindowStart, isoWeekKey } from "../src/domain/rules/digest";
import { FakePageCapturer } from "../src/infrastructure/evidence/EvidenceAdapters";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

type T = Awaited<ReturnType<typeof testPlatform>>;
const NOTE = "https://diario.example/politica/tarifas";
const S = { hour: 8, weekday: 1 };
// El reloj de las pruebas arranca el miércoles 23/09/2026 a las 15:00 UTC (12:00 en Argentina).

async function digestPlatform(extra: Parameters<typeof testPlatform>[0] = {}) {
  const pages = new FakePageCapturer();
  pages.set(NOTE, "Suben las tarifas", ["El gas aumenta 30% en marzo.", "Lo anunció el ministro Pérez."]);
  const t = await testPlatform({ ...extra, extra: { evidence: { capturer: pages }, ...extra.extra } });
  return { t, pages };
}

/** Persona con plan, que pidió el resumen por el chat. */
async function subscriber(t: T, planId: string, frequency: "diario" | "semanal", address = `+54911${Math.floor(Math.random() * 1e7)}`) {
  const u = await userWithPlan(t, planId, ["reader"], address);
  await t.p.inbound.execute(wa(address, `/resumen ${frequency}`, t.clock.now()));
  return { u, address };
}

const lastTo = (t: T, address: string) => t.whatsapp.outbox.filter((m) => m.to === address).at(-1);

describe("Resumen: cuándo toca", () => {
  test("diario: desde la hora elegida, en la hora local de cada país", () => {
    const now = new Date("2026-09-23T15:00:00Z");
    assert.deepEqual(digestDue("daily", now, -180, S), { due: true, periodKey: "2026-09-23" });
    assert.equal(digestDue("daily", new Date("2026-09-23T10:00:00Z"), -180, S).due, false, "07:00 en Argentina");
    assert.equal(digestDue("daily", new Date("2026-09-23T13:30:00Z"), -360, S).due, false, "07:30 en México");
    assert.equal(digestDue("daily", new Date("2026-09-24T02:00:00Z"), -180, S).periodKey, "2026-09-23", "23:00 del 23 en Argentina");
  });

  test("semanal: el día elegido o después (si el servidor estuvo caído, no se pierde)", () => {
    assert.deepEqual(digestDue("weekly", new Date("2026-09-21T12:00:00Z"), -180, S), { due: true, periodKey: "2026-W39" });
    assert.equal(digestDue("weekly", new Date("2026-09-21T10:00:00Z"), -180, S).due, false, "lunes 07:00");
    assert.equal(digestDue("weekly", new Date("2026-09-23T15:00:00Z"), -180, S).due, true, "miércoles");
    assert.equal(digestDue("weekly", new Date("2026-09-23T15:00:00Z"), -180, { hour: 8, weekday: 5 }).due, false, "le toca el viernes");
  });

  test("semanas ISO (el año de la semana lo define el jueves)", () => {
    assert.equal(isoWeekKey(new Date("2026-01-01T12:00:00Z")), "2026-W01");
    assert.equal(isoWeekKey(new Date("2027-01-01T12:00:00Z")), "2026-W53");
    assert.equal(isoWeekKey(new Date("2024-12-30T12:00:00Z")), "2025-W01");
  });

  test("desde cuándo contar: el último enviado, como mucho dos períodos atrás", () => {
    const now = new Date("2026-09-23T15:00:00Z");
    assert.equal(digestWindowStart("daily", now).toISOString(), "2026-09-22T15:00:00.000Z");
    assert.equal(digestWindowStart("daily", now, new Date("2026-09-23T11:00:00Z")).toISOString(), "2026-09-23T11:00:00.000Z");
    assert.equal(digestWindowStart("weekly", now, new Date("2026-06-01T00:00:00Z")).toISOString(), "2026-09-16T15:00:00.000Z");
  });
});

describe("Resumen: armado y envío", () => {
  test("las cuatro partes: notas vigiladas, temas, cadenas y fe de erratas", async () => {
    const { t, pages } = await digestPlatform();
    const { u, address } = await subscriber(t, "profesional", "diario");

    // Tema seguido con una nota nueva.
    const topic = (await t.store.repos.taxonomy.findTopics()).find((x) => x.active)!;
    await t.p.config.preferences.follow(u.id, topic.name);
    const base = demoSeed.searchableArticles[0]!;
    await t.store.repos.articles.saveMany([{ ...base, id: "a-nueva", url: "https://diario.example/nueva", title: "Nueva nota del tema", topic: topic.name, publishedAt: new Date(t.clock.now().getTime() - 3_600_000) }]);
    // Nota vigilada que después editan.
    await t.p.evidence.capture({ actorId: u.id, url: NOTE, monitor: true });
    pages.set(NOTE, "Suben las tarifas", ["El gas aumenta 45% en marzo.", "Lo anunció el ministro Pérez."]);
    t.clock.advance(25 * 3_600_000);
    await t.p.evidence.recheckDue();
    // Una cadena que circula y una fe de erratas.
    await t.store.repos.narratives.save({
      id: "n1", sample: "Mañana cortan el agua en todo el país, reenviá", keywords: ["agua"], topic: topic.name, firstSeenAt: t.clock.now(), lastSeenAt: t.clock.now(),
      occurrences: 42, byChannel: { whatsapp: 42 }, weekly: {}, avgSmokeIndex: 83, status: "circulating", campaignIds: [],
    });
    const outlet = (await t.store.repos.outlets.findAll())[0]!;
    await t.store.repos.corrections.save({ id: "c1", target: { type: "article", id: "x" }, outletId: outlet.id, description: "Corregimos el porcentaje del aumento.", publishedBy: "sistema", publishedAt: t.clock.now() });
    // Para que la nota nueva quede dentro de la ventana del resumen.
    await t.store.repos.articles.saveMany([{ ...base, id: "a-nueva", url: "https://diario.example/nueva", title: "Nueva nota del tema", topic: topic.name, publishedAt: new Date(t.clock.now().getTime() - 3_600_000) }]);

    const counts = await t.p.digests.runDue();
    assert.equal(counts.sent, 1);
    const msg = lastTo(t, address)!;
    assert.match(msg.text, /Tu resumen diario de Sin Humo/);
    assert.match(msg.text, /Notas que vigilás[\s\S]*Editaron «Suben las tarifas»: «El gas aumenta 30% en marzo\.» → «El gas aumenta 45% en marzo\.»/);
    assert.match(msg.text, new RegExp(`Tus temas[\\s\\S]*${topic.name}: 1 nota nueva\\. La última: «Nueva nota del tema»`));
    assert.match(msg.text, /Cadenas que circulan[\s\S]*42 veces, humo 83\/100/);
    assert.match(msg.text, new RegExp(`Fe de erratas[\\s\\S]*${outlet.name}: Corregimos el porcentaje`));
    assert.equal(msg.template?.name, "resumen_sin_humo", "afuera de la ventana de 24 h, con plantilla");

    // Uno solo por período, aunque corran varios servidores a la vez.
    const before = t.whatsapp.outbox.length;
    const again = await Promise.all([t.p.digests.runDue(), t.p.digests.runDue()]);
    assert.equal(t.whatsapp.outbox.length, before);
    assert.equal(again[0].already + again[1].already, 2);
  });

  test("sin novedades no se manda; el siguiente cuenta desde el último enviado", async () => {
    const { t } = await digestPlatform();
    const { u, address } = await subscriber(t, "profesional", "diario");
    const count = () => t.whatsapp.outbox.filter((m) => m.to === address).length;
    const afterSetup = count();
    t.clock.advance(24 * 3_600_000);
    assert.equal((await t.p.digests.runDue()).empty, 1);
    assert.equal(count(), afterSetup);
    const [last] = await t.store.repos.digests.findByUser(u.id, 1);
    assert.equal(last!.status, "empty");

    const a = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    await t.p.config.params.set({ actorId: a.id, key: "digest.send_empty", value: true, reason: "Probar el resumen vacío" });
    t.clock.advance(24 * 3_600_000);
    assert.equal((await t.p.digests.runDue()).sent, 1);
    assert.match(lastTo(t, address)!.text, /Sin novedades en este período/);
  });

  test("plan gratis: pide el diario, recibe el semanal", async () => {
    const { t } = await digestPlatform();
    const address = "+5491144448888";
    await userWithPlan(t, "gratis", ["reader"], address);
    const r = await t.p.inbound.execute(wa(address, "/resumen diario", t.clock.now()));
    assert.equal(r.response.title, "Listo: te mando el resumen semanal.");
    const a = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    await t.p.config.params.set({ actorId: a.id, key: "digest.send_empty", value: true, reason: "Ver el título del resumen" });
    t.clock.advance(60_000); // un mensaje cada 6 s a la misma persona: recién le contestó
    await t.p.digests.runDue();
    assert.match(lastTo(t, address)!.text, /Tu resumen semanal/);
  });

  test("horario de silencio: se posterga (no se pierde) y queda registrado", async () => {
    const { t } = await digestPlatform();
    const { u, address } = await subscriber(t, "profesional", "diario");
    await t.p.inbound.execute(wa(address, "/silencio 11-14", t.clock.now()));
    const a = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    await t.p.config.params.set({ actorId: a.id, key: "digest.send_empty", value: true, reason: "Probar el silencio" });
    const n = t.whatsapp.outbox.length;
    assert.equal((await t.p.digests.runDue()).deferred, 1);
    assert.equal(t.whatsapp.outbox.length, n, "no se mandó durante el silencio");
    assert.equal((await t.store.repos.digests.findByUser(u.id, 1))[0]!.status, "deferred");
  });

  test("por defecto de la organización; quien lo apaga no lo recibe, salvo que esté bloqueado", async () => {
    const { t } = await digestPlatform();
    const owner = await userWithPlan(t, "gratis");
    const org = await t.p.users.createOrganization.execute({ ownerId: owner.id, name: "Diario Norte" });
    const cur = await t.store.repos.subscriptions.findCurrent({ type: "organization", id: org.id });
    if (cur) await t.store.repos.subscriptions.save({ ...cur, status: "replaced", endedAt: t.clock.now() });
    await t.store.repos.subscriptions.save({ id: "sub-org", subject: { type: "organization", id: org.id }, planId: "equipo", status: "active", currentPeriodEnd: new Date("2028-01-01"), createdAt: new Date(t.clock.now().getTime() + 1) });
    const member = async (address: string) => {
      const m = await userWithPlan(t, "gratis", ["reader"], address);
      await t.store.repos.users.save({ ...m, organizationId: org.id });
      return m;
    };
    await member("+5491100000001");
    const quiet = await member("+5491100000002");
    await t.p.config.preferences.update({ actorId: quiet.id, values: { digest: "off" } });
    await t.store.repos.preferences.saveOrg({ organizationId: org.id, values: { digest: "daily" }, locked: [], updatedAt: t.clock.now(), updatedBy: owner.id });
    const a = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    await t.p.config.params.set({ actorId: a.id, key: "digest.send_empty", value: true, reason: "Probar la organización" });

    await t.p.digests.runDue();
    const got = () => new Set(t.whatsapp.outbox.filter((m) => /Tu resumen/.test(m.text)).map((m) => m.to));
    assert.ok(got().has("+5491100000001"));
    assert.ok(!got().has("+5491100000002"), "lo apagó");

    await t.store.repos.preferences.saveOrg({ organizationId: org.id, values: { digest: "daily" }, locked: ["digest"], updatedAt: t.clock.now(), updatedBy: owner.id });
    t.clock.advance(24 * 3_600_000);
    await t.p.digests.runDue();
    assert.ok(got().has("+5491100000002"), "la organización lo bloqueó");
  });

  test("partes extra por configuración; una que falla no tira abajo el resumen; apagado de emergencia", async () => {
    const broken: IDigestSource = { id: "rota", collect: async () => { throw new Error("caída"); } };
    const ok: IDigestSource = { id: "ok", collect: async (): Promise<DigestSection> => ({ source: "ok", title: "Parte que anda", items: [{ text: "Algo para contar." }] }) };
    const { t } = await digestPlatform({ extra: { digestSources: [broken, ok] } });
    const { address } = await subscriber(t, "profesional", "diario");
    t.clock.advance(60_000);
    assert.equal((await t.p.digests.runDue()).sent, 1);
    assert.match(lastTo(t, address)!.text, /Parte que anda[\s\S]*Algo para contar/);

    const a = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    await t.p.flags.update({ actorId: a.id, key: "digest", enabled: false });
    t.clock.advance(24 * 3_600_000);
    const n = t.whatsapp.outbox.filter((m) => m.to === address).length;
    assert.equal((await t.p.digests.runDue()).off >= 1, true);
    assert.equal(t.whatsapp.outbox.filter((m) => m.to === address).length, n);
  });

  test("chat: /resumen muestra las novedades ya; /resumen no lo apaga", async () => {
    const { t } = await digestPlatform();
    const { u, address } = await subscriber(t, "profesional", "semanal");
    assert.equal((await t.p.config.preferences.effective(u)).digest, "weekly");
    const now = await t.p.inbound.execute(wa(address, "/resumen", t.clock.now()));
    assert.equal(now.response.title, "Tu resumen semanal de Sin Humo");
    assert.equal((await t.store.repos.digests.findByUser(u.id, 5)).length, 0, "ver las novedades no cuenta como enviado");
    const off = await t.p.inbound.execute(wa(address, "/resumen no", t.clock.now()));
    assert.equal(off.response.title, "Listo: sin resumen.");
    assert.equal((await t.p.digests.runDue()).sent, 0);
  });
});

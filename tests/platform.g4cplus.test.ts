/** 4C+: temas y categorías, preferencias, reglas de negocio configurables y parámetros. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../src/domain/errors";
import type { AccessContext, DeclarativeRule } from "../src/domain/model";
import { evaluateDeclarative, factsFrom, matches, validateRule } from "../src/domain/rules/declarativeRules";
import { quietUntil, resolvePreferences } from "../src/domain/model";
import { FEEDBACK_ASK } from "../src/application/messaging/ResponseComposer";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

type T = Awaited<ReturnType<typeof testPlatform>>;
const CHAIN = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario. Es una catástrofe sin precedentes.";
const MARCH = { from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-03-31T23:00:00Z") };

const editor = async (t: T) => withRoles(t, (await userWithPlan(t, "gratis")).id, ["fact_checker"]);
const manager = async (t: T) => withRoles(t, (await userWithPlan(t, "gratis")).id, ["business_manager"]);

describe("Temas y categorías", () => {
  test("árbol inicial con rutas, y público por HTTP", async () => {
    const t = await testPlatform();
    const tree = await t.p.config.taxonomy.tree();
    const eco = tree.find((c) => c.id === "economia")!;
    const serv = eco.children.find((c) => c.id === "servicios-publicos")!;
    assert.equal(serv.path, "Economía › Servicios públicos");
    assert.ok(serv.topics.some((x) => x.name === "tarifas de gas" && x.synonyms.includes("garrafa")));
  });

  test("editar: sin ambigüedades, sin ciclos, sin dejar temas huérfanos; sólo con permiso", async () => {
    const t = await testPlatform();
    const ed = await editor(t);
    const cat = await t.p.config.taxonomy.saveCategory({ actorId: ed.id, name: "Turismo", parentId: "economia" });
    assert.equal(cat.id, "turismo");
    const topic = await t.p.config.taxonomy.saveTopic({ actorId: ed.id, name: "Temporada de verano", categoryId: "turismo", keywords: ["turistas", "temporada"], synonyms: ["vacaciones"] });
    assert.equal(topic.id, "temporada-de-verano");

    await assert.rejects(
      t.p.config.taxonomy.saveTopic({ actorId: ed.id, name: "Garrafas", categoryId: "turismo", keywords: ["garrafa"], synonyms: ["gas"] }),
      (e: ConflictError) => /tarifas de gas/.test(e.message),
      "'gas' ya identifica a otro tema",
    );
    await assert.rejects(t.p.config.taxonomy.saveTopic({ actorId: ed.id, name: "Vacío", categoryId: "turismo", keywords: [] }), ValidationError);
    await assert.rejects(t.p.config.taxonomy.saveCategory({ actorId: ed.id, id: "economia", name: "Economía", parentId: "turismo" }), /dentro de sí misma/);
    await assert.rejects(t.p.config.taxonomy.saveCategory({ actorId: ed.id, id: "turismo", name: "Turismo", parentId: "economia", active: false }), ConflictError);

    // Se desactiva el tema y después la categoría: no se borra nada.
    await t.p.config.taxonomy.saveTopic({ actorId: ed.id, id: topic.id, name: topic.name, categoryId: "turismo", keywords: topic.keywords, active: false });
    await t.p.config.taxonomy.saveCategory({ actorId: ed.id, id: "turismo", name: "Turismo", parentId: "economia", active: false });
    assert.ok(!(await t.p.config.taxonomy.tree()).find((c) => c.id === "economia")!.children.some((c) => c.id === "turismo"));
    assert.ok((await t.p.config.taxonomy.tree(true)).find((c) => c.id === "economia")!.children.some((c) => c.id === "turismo"));

    const reader = await userWithPlan(t, "empresa");
    await assert.rejects(t.p.config.taxonomy.saveCategory({ actorId: reader.id, name: "X" }), AccessDeniedError);
    assert.ok((await t.store.repos.audit.find({ action: "taxonomy.changed" })).length >= 4);
  });

  test("sinónimos: '/comparar gas' usa el tema oficial; un tema nuevo se reconoce enseguida", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "personal");
    const r = await t.p.gateway.compareSources({ userId: u.id, channel: "web" }, { topic: "Gas", period: MARCH });
    assert.equal(r.topic, "tarifas de gas");
    assert.ok(r.outletIds.length >= 2);

    const ed = await editor(t);
    assert.equal(await t.p.config.topics.resolve("vacaciones"), undefined);
    await t.p.config.taxonomy.saveTopic({ actorId: ed.id, name: "turismo", categoryId: "economia", keywords: ["turistas"], synonyms: ["vacaciones"] });
    assert.equal((await t.p.config.topics.resolve("Vacaciones"))?.name, "turismo", "el índice se invalida al editar");
    assert.equal(await t.p.config.topics.classify("Récord de turistas en la costa"), "turismo");
  });
});

describe("Preferencias", () => {
  test("por chat: seguir temas, formato corto, silencio y ver todo", async () => {
    const t = await testPlatform();
    const from = "+5491155550001";
    const say = async (text: string) => {
      t.clock.advance(60_000);
      return (await t.p.inbound.execute(wa(from, text, t.clock.now()))).response;
    };
    assert.match((await say("/seguir garrafa")).title, /seguís "tarifas de gas"/);
    assert.match((await say("/seguir fútbol")).summary!, /No conozco el tema/);
    const topics = await say("/temas");
    assert.ok(topics.sections.some((s) => s.lines.some((l) => l.startsWith("✓ tarifas de gas"))));

    const long = await say(CHAIN);
    const longLines = long.sections.flatMap((s) => s.lines).length;
    await say("/formato corto");
    const short = await say(`${CHAIN} (otra vez)`);
    assert.ok(short.sections.flatMap((s) => s.lines).length <= 3);
    assert.ok(longLines > 3, "el detallado tenía más");

    assert.match((await say("/silencio 22-8")).title, /22:00 a 08:00/);
    const prefs = await say("/preferencias");
    const lines = prefs.sections[0]!.lines.join("\n");
    assert.match(lines, /Temas que seguís: tarifas de gas/);
    assert.match(lines, /Formato de respuesta: corto/);
    assert.match(lines, /22:00 a 08:00/);
    assert.match((await say("/dejar gas")).title, /Dejaste de seguir/);
    assert.match((await say("/silencio no")).title, /sin horario de silencio/);
  });

  test("horario de silencio: el aviso se posterga y llega cuando termina", async () => {
    const t = await testPlatform();
    const from = "+5491155550002";
    await t.p.inbound.execute(wa(from, "/silencio 22-8", t.clock.now()));
    const u = (await t.store.repos.users.findByChannel("whatsapp", from))!;
    const before = t.whatsapp.outbox.length;
    t.clock.set(new Date("2026-09-24T02:00:00Z")); // 23 h en Argentina
    const tpl = { name: "alerta_tema", language: "es_AR", params: ["x"] };
    const r = await t.p.notifications.notifyUser(u, { kind: "info", title: "Novedad", sections: [], links: [] }, ["whatsapp"], tpl);
    assert.equal(r.deferredUntil?.toISOString(), "2026-09-24T11:00:00.000Z", "08:00 hora argentina");
    assert.equal(t.whatsapp.outbox.length, before, "no se mandó de noche");

    t.clock.set(new Date("2026-09-24T11:01:00Z"));
    await t.p.jobs.worker().runOnce();
    assert.equal(t.whatsapp.outbox.length, before + 1);
    assert.match(t.whatsapp.outbox.at(-1)!.text, /Novedad/);
  });

  test("organización: valores por defecto y bloqueos; canales de aviso sólo verificados", async () => {
    const t = await testPlatform();
    const admin = await userWithPlan(t, "gratis");
    const org = await t.p.users.createOrganization.execute({ ownerId: admin.id, name: "Consultora Sur" });
    const m = await userWithPlan(t, "gratis");
    m.organizationId = org.id;
    await t.store.repos.users.save(m);

    await t.p.config.preferences.setOrgDefaults({ actorId: admin.id, values: { responseFormat: "short", digest: "weekly" }, locked: ["responseFormat"] });
    const eff = await t.p.config.preferences.effective(m);
    assert.equal(eff.responseFormat, "short");
    assert.equal(eff.source.responseFormat, "locked");
    assert.equal(eff.source.digest, "organization");
    await assert.rejects(t.p.config.preferences.update({ actorId: m.id, values: { responseFormat: "detailed" } }), /Tu organización fijó/);
    const mine = await t.p.config.preferences.update({ actorId: m.id, values: { digest: "daily" } });
    assert.equal(mine.digest, "daily", "lo no bloqueado se puede cambiar");
    await assert.rejects(t.p.config.preferences.setOrgDefaults({ actorId: m.id, values: {} }), AccessDeniedError);

    await assert.rejects(t.p.config.preferences.update({ actorId: m.id, values: { notifyChannels: ["telegram"] } }), /verificá/);
    await assert.rejects(t.p.config.preferences.update({ actorId: m.id, values: { quietHours: { from: "25:00", to: "08:00", utcOffsetMinutes: -180 } } }), ValidationError);
    await assert.rejects(t.p.config.preferences.update({ actorId: m.id, values: { mutedCategories: ["no-existe"] } }), ValidationError);
  });

  test("silenciar una categoría silencia sus subcategorías (campañas y avisos)", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "gratis");
    await t.p.config.preferences.update({ actorId: u.id, values: { mutedCategories: ["economia"], followedTopics: ["gas"] } });
    const fresh = (await t.store.repos.users.findById(u.id))!;
    assert.equal(await t.p.config.preferences.isMuted(fresh, "tarifas de gas"), true);
    assert.equal(await t.p.config.preferences.isMuted(fresh, "seguridad"), false);
    assert.deepEqual(await t.p.config.preferences.followers("garrafa"), [u.id]);
  });

  test("reglas puras: resolución de preferencias y horario de silencio", () => {
    const eff = resolvePreferences(
      { userId: "u", values: { responseFormat: "detailed", digest: "daily" }, updatedAt: new Date() },
      { organizationId: "o", values: { responseFormat: "short" }, locked: ["responseFormat"], updatedAt: new Date(), updatedBy: "a" },
    );
    assert.equal(eff.responseFormat, "short");
    assert.equal(eff.digest, "daily");
    const q = { from: "22:00", to: "08:00", utcOffsetMinutes: -180 };
    assert.equal(quietUntil(q, new Date("2026-09-24T15:00:00Z")), undefined, "12 h: no");
    assert.equal(quietUntil(q, new Date("2026-09-24T01:30:00Z"))?.toISOString(), "2026-09-24T11:00:00.000Z", "22:30 → 8 del día siguiente");
    assert.equal(quietUntil(q, new Date("2026-09-24T09:00:00Z"))?.toISOString(), "2026-09-24T11:00:00.000Z", "6 h → 8 del mismo día");
    assert.equal(quietUntil({ from: "13:00", to: "14:00", utcOffsetMinutes: -180 }, new Date("2026-09-24T16:30:00Z"))?.toISOString(), "2026-09-24T17:00:00.000Z");
  });
});

describe("Reglas de negocio configurables", () => {
  test("promoción: borrador → prueba → aprueba OTRA persona → regala una función hasta la fecha de fin", async () => {
    const t = await testPlatform();
    const a = await manager(t);
    const b = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    const free = await userWithPlan(t, "gratis");
    const query = { outletId: "ddv", topic: "tarifas de gas", period: { from: new Date("2026-01-01"), to: new Date("2026-08-31") } };
    await assert.rejects(t.p.gateway.evaluateCredibility({ userId: free.id, channel: "web" }, query), (e: AccessDeniedError) => e.code === "feature_not_in_plan");

    const R = t.p.config.businessRules;
    await assert.rejects(
      R.saveDraft({ actorId: a.id, name: "Semana de la credibilidad", scope: { type: "platform" }, conditions: [{ field: "plan", op: "eq", value: "gratis" }], effect: { type: "grant_feature", feature: "credibility_meter" } }),
      /fecha de fin/,
    );
    const draft = await R.saveDraft({
      actorId: a.id, name: "Semana de la credibilidad", scope: { type: "platform" }, priority: 10,
      conditions: [{ field: "plan", op: "eq", value: "gratis" }], effect: { type: "grant_feature", feature: "credibility_meter" },
      validFrom: new Date("2026-09-20T00:00:00Z"), validTo: new Date("2026-09-27T03:00:00Z"),
    });
    assert.equal(draft.status, "draft");
    await assert.rejects(R.approve({ actorId: b.id, ruleId: draft.id }), /Probá la regla/);
    const test1 = await R.test({ actorId: a.id, ruleId: draft.id, scenarios: [
      { name: "gratis recibe la promo", facts: { plan: "gratis" }, expect: "grant" },
      { name: "personal no cambia", facts: { plan: "personal" }, expect: "allow" },
    ] });
    assert.equal(test1.passed, true);
    await assert.rejects(R.approve({ actorId: a.id, ruleId: draft.id }), /otra persona/);
    const active = await R.approve({ actorId: b.id, ruleId: draft.id });
    assert.equal(active.approvedBy, b.id);

    const r = await t.p.gateway.evaluateCredibility({ userId: free.id, channel: "web" }, query);
    assert.equal(r.outletName, "El Diario del Valle");

    t.clock.set(new Date("2026-09-28T12:00:00Z"));
    await assert.rejects(t.p.gateway.evaluateCredibility({ userId: free.id, channel: "web" }, query), (e: AccessDeniedError) => e.code === "feature_not_in_plan", "terminó la promo");
  });

  test("límite más estricto por canal, versiones y archivo", async () => {
    const t = await testPlatform();
    const a = await manager(t);
    const b = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["business_manager"]);
    const R = t.p.config.businessRules;
    const rule = await R.saveDraft({
      actorId: a.id, name: "Gratis por WhatsApp", scope: { type: "platform" },
      conditions: [{ field: "plan", op: "eq", value: "gratis" }, { field: "channel", op: "eq", value: "whatsapp" }, { field: "action", op: "in", value: ["analyze_smoke", "analyze_content"] }],
      effect: { type: "limit", metric: "analyses", max: 2, message: "Por WhatsApp el plan Gratis tiene 2 análisis por día." },
    });
    await R.test({ actorId: a.id, ruleId: rule.id, scenarios: [
      { name: "tercero", facts: { plan: "gratis", channel: "whatsapp", action: "analyze_smoke", usage: { analyses: 2, comparisons: 0 } }, expect: "deny" },
      { name: "por web no", facts: { plan: "gratis", channel: "web", action: "analyze_smoke", usage: { analyses: 2, comparisons: 0 } }, expect: "allow" },
    ] });
    await R.approve({ actorId: b.id, ruleId: rule.id });

    const u = await userWithPlan(t, "gratis");
    const call = () => t.p.gateway.analyzeSmoke({ userId: u.id, channel: "whatsapp" }, CHAIN);
    await call();
    await call();
    await assert.rejects(call(), (e: AccessDeniedError) => e.code === "quota_exceeded" && /2 análisis por día/.test(e.message));
    await t.p.gateway.analyzeSmoke({ userId: u.id, channel: "web" }, CHAIN); // por web, el límite del plan (5)

    // Editar una regla activa crea la versión 2 en borrador; la 1 sigue vigente.
    const v2 = await R.saveDraft({ actorId: a.id, id: rule.id, name: rule.name, scope: rule.scope, conditions: rule.conditions, effect: { type: "limit", metric: "analyses", max: 10 } });
    assert.equal(v2.version, 2);
    await assert.rejects(call(), AccessDeniedError, "sigue la versión 1");
    const history = await R.history(a.id, rule.id);
    assert.deepEqual(history.map((h) => [h.version, h.status]), [[1, "active"], [2, "draft"]]);

    await R.archive({ actorId: a.id, ruleId: rule.id });
    await call(); // sin la regla: vuelve el límite del plan
    assert.ok((await t.store.repos.audit.find({ action: "business_rule.changed" })).length >= 4);
  });

  test("regla de una organización: sólo para sus miembros, sólo bloquear o limitar", async () => {
    const t = await testPlatform();
    const admin = await userWithPlan(t, "gratis");
    const org = await t.p.users.createOrganization.execute({ ownerId: admin.id, name: "Estudio Norte" });
    const orgAdmin = (await t.store.repos.users.findById(admin.id))!;
    const member = await userWithPlan(t, "gratis");
    member.organizationId = org.id;
    await t.store.repos.users.save(member);
    const outsider = await userWithPlan(t, "personal");
    const R = t.p.config.businessRules;

    await assert.rejects(
      R.saveDraft({ actorId: orgAdmin.id, name: "Promo", scope: { type: "organization", id: org.id }, conditions: [], effect: { type: "grant_feature", feature: "alerts" }, validTo: new Date("2027-01-01") }),
      /Sólo la plataforma puede regalar/,
    );
    await assert.rejects(
      R.saveDraft({ actorId: orgAdmin.id, name: "Otra org", scope: { type: "organization", id: "org-ajena" }, conditions: [{ field: "hour", op: "gte", value: 20 }], effect: { type: "deny", message: "x" } }),
      AccessDeniedError,
    );
    const rule = await R.saveDraft({
      actorId: orgAdmin.id, name: "Sin comparaciones de noche", scope: { type: "organization", id: org.id },
      conditions: [{ field: "action", op: "eq", value: "compare_sources" }, { field: "hour", op: "gte", value: 20 }],
      effect: { type: "deny", message: "En Estudio Norte las comparaciones se hacen en horario laboral." },
    });
    await R.test({ actorId: orgAdmin.id, ruleId: rule.id, scenarios: [{ name: "23 h", facts: { action: "compare_sources", hour: 23 }, expect: "deny" }] });
    await R.approve({ actorId: orgAdmin.id, ruleId: rule.id }); // en una organización puede aprobar quien la creó

    t.clock.set(new Date("2026-09-24T02:00:00Z")); // 23 h
    await assert.rejects(t.p.gateway.compareSources({ userId: member.id, channel: "web" }, { topic: "gas", period: MARCH }), (e: AccessDeniedError) => e.code === "business_rule" && /horario laboral/.test(e.message));
    await t.p.gateway.compareSources({ userId: outsider.id, channel: "web" }, { topic: "gas", period: MARCH });
    assert.equal((await R.list(orgAdmin.id)).length, 1, "ve sólo las de su organización");
  });

  test("las reglas fijas corren primero: una promo nunca da permisos que el rol no tiene", () => {
    const ctx = {
      user: { id: "u", name: "U", status: "active", roleIds: ["reader"], channels: [], createdAt: new Date("2026-01-01") },
      permissions: new Set(), plan: { id: "gratis" }, subscription: {}, usage: { analyses: 0, comparisons: 0 },
      action: { id: "compare_sources" }, channel: "web", request: { topic: "Elecciones" }, now: new Date("2026-09-24T02:30:00Z"),
    } as unknown as AccessContext;
    const f = factsFrom(ctx);
    assert.equal(f.hour, 23);
    assert.equal(f.weekday, 3, "miércoles en Argentina");
    assert.equal(f.date, "2026-09-23");
    assert.equal(f.topic, "elecciones");
    assert.ok(matches({ field: "role", op: "in", value: ["reader", "analyst"] }, f));
    assert.ok(matches({ field: "account_age_days", op: "gte", value: 200 }, f));
    const deny = { id: "veda", version: 1, name: "Veda", scope: { type: "platform" }, priority: 1, status: "active", createdBy: "x", createdAt: new Date(),
      conditions: [{ field: "topic", op: "eq", value: "elecciones" }, { field: "date", op: "gte", value: "2026-09-20" }], effect: { type: "deny", message: "Veda electoral." } } as DeclarativeRule;
    assert.equal(evaluateDeclarative([deny], f, ctx.now).denial?.message, "Veda electoral.");
    assert.equal(evaluateDeclarative([{ ...deny, status: "draft" }], f, ctx.now).denial, undefined, "un borrador no aplica");
    assert.deepEqual(validateRule({ ...deny, conditions: [] }), ["Un bloqueo sin condiciones bloquearía a todos: agregá al menos una."]);
    assert.ok(validateRule({ ...deny, conditions: [{ field: "hour", op: "in", value: 3 }] }).some((e) => /lista/.test(e)));
    assert.ok(validateRule({ ...deny, conditions: [{ field: "nope" as never, op: "eq", value: 1 }] }).some((e) => /desconocido/.test(e)));
  });
});

describe("Parámetros de negocio", () => {
  test("rango, motivo y versiones; el cambio se aplica sin tocar código", async () => {
    const t = await testPlatform();
    const a = await manager(t);
    const P = t.p.config.params;
    await assert.rejects(P.set({ actorId: a.id, key: "smoke.threshold", value: 200, reason: "prueba de rango máximo" }), /entre 5 y 95/);
    await assert.rejects(P.set({ actorId: a.id, key: "smoke.threshold", value: 40, reason: "" }), /motivo/);
    await assert.rejects(P.set({ actorId: a.id, key: "no.existe", value: 1, reason: "no existe este parámetro" }), NotFoundError);
    await assert.rejects(P.set({ actorId: a.id, key: "smoke.threshold", value: "40", reason: "tipo incorrecto a propósito" }), /tipo number/);
    const reader = await userWithPlan(t, "empresa");
    await assert.rejects(P.set({ actorId: reader.id, key: "smoke.threshold", value: 40, reason: "sin permiso para esto" }), AccessDeniedError);

    // Apagar la pregunta "¿Te sirvió?" desde la configuración.
    const r1 = await t.p.inbound.execute(wa("+5491144440001", CHAIN, t.clock.now()));
    assert.ok(r1.response.footer?.includes(FEEDBACK_ASK));
    await P.set({ actorId: a.id, key: "chat.show_feedback_question", value: false, reason: "Campaña piloto sin encuesta" });
    t.clock.advance(60_000);
    const r2 = await t.p.inbound.execute(wa("+5491144440001", `${CHAIN} bis`, t.clock.now()));
    assert.ok(!r2.response.footer?.includes(FEEDBACK_ASK));

    await P.set({ actorId: a.id, key: "smoke.threshold", value: 40, reason: "Menos falsos positivos en el piloto" });
    await P.set({ actorId: a.id, key: "smoke.threshold", value: 35, reason: "Ajuste después de revisar ejemplos" });
    const list = await P.list(a.id);
    const th = list.find((p) => p.key === "smoke.threshold")!;
    assert.equal(th.value, 35);
    assert.equal(th.changed?.version, 2);
    assert.equal(await P.number("smoke.threshold"), 35);
    const audit = await t.store.repos.audit.find({ action: "parameter.changed" });
    assert.ok(audit.some((e) => e.data.reason === "Menos falsos positivos en el piloto"));
  });
});

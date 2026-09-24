/** 4D: comercial (plan anual, cupones, referidos, marca blanca), inclusión (aprendizaje, lectura fácil, audio), países, funciones en prueba y soporte. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { contrastWithWhite } from "../src/application/commerce/Commerce";
import { bucketOf, evaluateFlag } from "../src/application/flags/FeatureFlags";
import { guessCategory } from "../src/application/support/Support";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../src/domain/errors";
import type { FeatureFlag } from "../src/domain/model";
import { isValidChileRut, isValidMexicoRfc, isValidUruguayRut } from "../src/domain/rules/taxIds";
import { CsvCatalogSource } from "../src/infrastructure/catalog/CatalogAdapters";
import { SvgCardGenerator } from "../src/infrastructure/participation/Participation";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

type T = Awaited<ReturnType<typeof testPlatform>>;
const CHAIN = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario. Es una catástrofe histórica sin precedentes.";
const admin = async (t: T) => withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);

async function pay(t: T, userId: string, planId: string, extra: { interval?: "month" | "year"; couponCode?: string } = {}) {
  const r = await t.p.users.changePlan.execute({ actorId: userId, planId, ...extra });
  if (r.subscription.status === "pending_payment") await t.p.users.confirmPayment.execute({ subscriptionId: r.subscription.id });
  return r;
}

async function org(t: T, planId: string, kind?: "school") {
  const a = await userWithPlan(t, "gratis");
  const o = await t.p.users.createOrganization.execute({ ownerId: a.id, name: kind ? "Escuela N° 5" : "Diario Norte" });
  if (kind) await t.store.repos.organizations.save({ ...(await t.store.repos.organizations.findById(o.id))!, kind });
  const cur = await t.store.repos.subscriptions.findCurrent({ type: "organization", id: o.id });
  if (cur) await t.store.repos.subscriptions.save({ ...cur, status: "replaced", endedAt: t.clock.now() });
  await t.store.repos.subscriptions.save({ id: `sub-${o.id}`, subject: { type: "organization", id: o.id }, planId, status: "active", currentPeriodEnd: new Date("2028-01-01"), createdAt: new Date(t.clock.now().getTime() + 1) });
  const member = async (roleId = "reader", address?: string) => {
    const u = await userWithPlan(t, "gratis", ["reader"], address);
    u.organizationId = o.id;
    await t.store.repos.users.save(u);
    if (roleId !== "reader") await t.p.users.roles.assign({ actorId: a.id, targetId: u.id, roleId });
    return (await t.store.repos.users.findById(u.id))!;
  };
  return { admin: (await t.store.repos.users.findById(a.id))!, org: o, member };
}

describe("Plan anual y cupones", () => {
  test("cotización: anual con meses de regalo e IVA incluido", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "gratis");
    const q = await t.p.commerce.service.quote({ userId: u.id, planId: "personal", interval: "year" });
    assert.equal(q.amount, 49_900);
    assert.equal(q.yearlySavings, 4_990 * 12 - 49_900);
    assert.deepEqual({ ...q.tax, amount: Math.round(q.tax.amount) }, { name: "IVA", rate: 0.21, included: true, amount: Math.round(49_900 - 49_900 / 1.21) });
    await assert.rejects(t.p.commerce.service.quote({ userId: u.id, planId: "gratis", interval: "month" }), /es gratis/);
  });

  test("cupón: descuento, cobro, factura, uso único por persona y tope de usos", async () => {
    const t = await testPlatform();
    const a = await admin(t);
    await assert.rejects(t.p.commerce.service.createCoupon({ actorId: (await userWithPlan(t, "empresa")).id, code: "X", kind: "percent", value: 10, description: "x" }), AccessDeniedError);
    await assert.rejects(t.p.commerce.service.createCoupon({ actorId: a.id, code: "MAL", kind: "percent", value: 150, description: "x" }), ValidationError);
    await t.p.commerce.service.createCoupon({ actorId: a.id, code: "lanzamiento25", kind: "percent", value: 25, description: "Lanzamiento", planIds: ["personal"], maxRedemptions: 1 });

    const u = await userWithPlan(t, "gratis");
    const q = await t.p.commerce.service.quote({ userId: u.id, planId: "personal", interval: "month", couponCode: "LANZAMIENTO25" });
    assert.equal(q.discount, 1_247.5);
    assert.equal(q.amount, 3_742.5);
    await assert.rejects(t.p.commerce.service.quote({ userId: u.id, planId: "profesional", interval: "month", couponCode: "LANZAMIENTO25" }), /no vale para ese plan/);

    const r = await pay(t, u.id, "personal", { couponCode: "lanzamiento25" });
    assert.equal(t.payments.checkouts.at(-1)!.amount, 3_742.5, "se cobra con el descuento");
    const cur = await t.store.repos.subscriptions.findCurrent({ type: "user", id: u.id });
    assert.equal(cur?.id, r.subscription.id);
    assert.equal((await t.store.repos.coupons.find("LANZAMIENTO25"))?.redemptions, 1);
    await t.p.jobs.worker().runOnce();
    const [inv] = await t.store.repos.invoices.findBySubject({ type: "user", id: u.id });
    assert.equal(inv?.total, 3_742.5);
    assert.match(inv!.lines[0]!.description, /cupón LANZAMIENTO25/);

    await assert.rejects(t.p.commerce.service.quote({ userId: u.id, planId: "personal", interval: "month", couponCode: "LANZAMIENTO25" }), /todas las veces|Ya usaste/);
    const other = await userWithPlan(t, "gratis");
    await assert.rejects(t.p.commerce.service.quote({ userId: other.id, planId: "personal", interval: "month", couponCode: "LANZAMIENTO25" }), /todas las veces/);
  });

  test("cupón del 100%: se activa sin cobro ni factura", async () => {
    const t = await testPlatform();
    const a = await admin(t);
    await t.p.commerce.service.createCoupon({ actorId: a.id, code: "BECA-PRENSA", kind: "percent", value: 100, description: "Beca", newCustomersOnly: true });
    const u = await userWithPlan(t, "gratis");
    const r = await t.p.users.changePlan.execute({ actorId: u.id, planId: "profesional", couponCode: "BECA-PRENSA" });
    assert.equal(r.subscription.status, "active");
    assert.equal(r.checkoutUrl, undefined);
    await t.p.jobs.worker().runOnce();
    assert.equal((await t.store.repos.invoices.findBySubject({ type: "user", id: u.id })).length, 0);
    assert.ok(await t.store.repos.coupons.findRedemption("BECA-PRENSA", `user:${u.id}`));
  });
});

describe("Otros países", () => {
  test("precio, moneda e IVA del país; identificación fiscal con dígito verificador", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "gratis");
    await assert.rejects(t.p.commerce.service.setCountry({ actorId: u.id, country: "BR" }), /Todavía no operamos/);
    await t.p.commerce.service.setCountry({ actorId: u.id, country: "uy" });
    const q = await t.p.commerce.service.quote({ userId: u.id, planId: "personal", interval: "month" });
    assert.deepEqual([q.currency, q.amount, q.tax.rate, q.country], ["UYU", 290, 0.22, "UY"]);

    assert.ok(isValidChileRut("11.111.111-1"));
    assert.ok(!isValidChileRut("11.111.111-2"));
    assert.ok(isValidMexicoRfc("GODE561231GR8"));
    assert.ok(!isValidMexicoRfc("123"));
    assert.ok(!isValidUruguayRut("123"));

    const cl = await userWithPlan(t, "gratis");
    await t.p.commerce.service.setCountry({ actorId: cl.id, country: "CL" });
    const p = await t.p.billing.setProfile.execute({ actorId: cl.id, legalName: "Prensa Sur SpA", taxIdType: "RUT", taxId: "11.111.111-1", taxCondition: "consumidor_final", country: "CL" });
    assert.equal(p.country, "CL");
    await assert.rejects(t.p.billing.setProfile.execute({ actorId: cl.id, legalName: "Prensa Sur SpA", taxIdType: "RUT", taxId: "11.111.111-2", taxCondition: "consumidor_final", country: "CL" }), /RUT inválido/);
  });

  test("regiones: el catálogo avisa si una provincia no existe en el país", async () => {
    const csv = "id;nombre;url;pais;provincia\nnh;Norte Hoy;https://nh.example;AR;Salta\nxx;Otro;https://xx.example;AR;Provincia Inventada\nuy;Diario UY;https://uy.example;UY;Paysandú";
    const t = await testPlatform({ extra: { catalogSources: [new CsvCatalogSource("m", "medios", "outlets", { text: csv })] } });
    const a = await admin(t);
    const r = await t.p.catalog.import.execute({ actorId: a.id, sourceId: "m" });
    assert.equal(r.outlets, 3);
    assert.deepEqual(r.warnings, ['Medio xx: "Provincia Inventada" no es una región de Argentina.']);
  });
});

describe("Referidos", () => {
  test("bienvenida para quien llega; premio para quien invita cuando el invitado paga; sin trampas", async () => {
    const t = await testPlatform();
    const inviter = await userWithPlan(t, "personal", ["reader"], "+5491122220001");
    const code = (await t.p.inbound.execute(wa("+5491122220001", "/invitar", t.clock.now()))).response.title.replace("Tu código: ", "");
    assert.match(code, /^[A-Z]+-[0-9A-F]{4}$/);

    await assert.rejects(t.p.commerce.referrals.apply({ userId: inviter.id, code }), /propio código|todavía no contrató/);
    const newbie = await t.p.users.register.execute({ name: "Beto", channel: { type: "whatsapp", address: "+5491122220002", verified: true } });
    t.clock.advance(60_000);
    const r = await t.p.inbound.execute(wa("+5491122220002", `/codigo ${code}`, t.clock.now()));
    assert.match(r.response.summary!, /20% de descuento.*BIENVENIDA-/);
    await assert.rejects(t.p.commerce.referrals.apply({ userId: newbie.id, code }), ConflictError);

    const welcome = (await t.store.repos.referrals.findUse(newbie.id))!.welcomeCoupon!;
    const before = t.whatsapp.outbox.length;
    await pay(t, newbie.id, "personal", { couponCode: welcome });
    const use = (await t.store.repos.referrals.findUse(newbie.id))!;
    assert.equal(use.status, "rewarded");
    const reward = (await t.store.repos.coupons.find(use.rewardCoupon!))!;
    assert.equal(reward.value, 100);
    assert.deepEqual(reward.restrictedTo, { type: "user", id: inviter.id });
    assert.ok(t.whatsapp.outbox.slice(before).some((m) => m.to === "+5491122220001"), "le avisamos a quien invitó");
    await assert.rejects(t.p.commerce.service.quote({ userId: newbie.id, planId: "personal", interval: "month", couponCode: reward.code }), /personal/);

    // Ventana de uso vencida
    const late = await userWithPlan(t, "gratis");
    t.clock.advance(20 * 86_400_000);
    await assert.rejects(t.p.commerce.referrals.apply({ userId: late.id, code }), /primeros 14 días/);
  });
});

describe("Marca blanca", () => {
  test("marca propia en las respuestas; contraste accesible; sólo plan Empresa", async () => {
    const t = await testPlatform();
    const { admin: boss, member } = await org(t, "empresa");
    await assert.rejects(t.p.commerce.branding.update({ actorId: boss.id, displayName: "Diario Norte", primaryColor: "#ffff00" }), /contraste/);
    await t.p.commerce.branding.update({ actorId: boss.id, displayName: "Diario Norte", primaryColor: "#0b3d91", emailFromName: "Chequeo Diario Norte" });
    const m = await member("reader", "+5491133330001");
    const r = await t.p.inbound.execute(wa("+5491133330001", CHAIN, t.clock.now()));
    assert.equal(r.response.brand?.name, "Diario Norte");
    assert.match(t.whatsapp.outbox.at(-1)!.text, /Diario Norte · con tecnología de Sin Humo/);
    await t.p.commerce.branding.update({ actorId: boss.id, hidePoweredBy: true });
    t.clock.advance(60_000);
    await t.p.inbound.execute(wa("+5491133330001", `${CHAIN} (2)`, t.clock.now()));
    assert.doesNotMatch(t.whatsapp.outbox.at(-1)!.text, /Sin Humo/);
    assert.equal(m.organizationId, boss.organizationId);

    const small = await org(t, "equipo");
    await assert.rejects(t.p.commerce.branding.update({ actorId: small.admin.id, displayName: "X" }), (e: AccessDeniedError) => e.code === "feature_not_in_plan");
    assert.ok(contrastWithWhite("#0b3d91") >= 4.5);
  });

  test("dominio propio: se verifica por DNS y no se puede tomar el de otro", async () => {
    const t = await testPlatform();
    const { admin: boss } = await org(t, "empresa");
    await t.p.commerce.branding.update({ actorId: boss.id, displayName: "Diario Norte" });
    const d = await t.p.commerce.branding.setDomain({ actorId: boss.id, domain: "Chequeo.DiarioNorte.example" });
    assert.equal(d.txtName, "_sinhumo.chequeo.diarionorte.example");
    await assert.rejects(t.p.commerce.branding.verifyDomain(boss.id), /No encontramos el registro TXT/);
    assert.equal(await t.p.commerce.branding.byHost("chequeo.diarionorte.example"), undefined, "sin verificar no se usa");
    t.dns.records[d.txtName] = [d.txtValue];
    await t.p.commerce.branding.verifyDomain(boss.id);
    assert.equal((await t.p.commerce.branding.byHost("chequeo.diarionorte.example:443"))?.displayName, "Diario Norte");

    const other = await org(t, "empresa");
    await t.p.commerce.branding.update({ actorId: other.admin.id, displayName: "Otro" });
    await assert.rejects(t.p.commerce.branding.setDomain({ actorId: other.admin.id, domain: "chequeo.diarionorte.example" }), ConflictError);
    await assert.rejects(t.p.commerce.branding.setDomain({ actorId: other.admin.id, domain: "x.sinhumo.example" }), /de la plataforma/);
  });
});

describe("Modo aprendizaje", () => {
  test("jugar por chat: pregunta, respuesta, explicación, racha y nivel", async () => {
    const t = await testPlatform();
    const from = "+5491144440101";
    const say = async (text: string) => {
      t.clock.advance(60_000);
      return (await t.p.inbound.execute(wa(from, text, t.clock.now()))).response;
    };
    const q = await say("/jugar");
    assert.equal(q.title, "¿Esto es humo?");
    const u = (await t.store.repos.users.findByChannel("whatsapp", from))!;
    const pending1 = (await t.store.repos.learning.getState(u.id))!.pendingItemId;
    const item = (await t.store.repos.learning.findItems()).find((i) => i.id === pending1)!;
    const right = await say(item.isSmoke ? "HUMO" : "limpio");
    assert.match(right.title, /¡Bien!/);
    assert.ok(right.summary!.length > 20, "explica qué mirar");
    await say("/jugar");
    const pending2 = (await t.store.repos.learning.getState(u.id))!.pendingItemId;
    const item2 = (await t.store.repos.learning.findItems()).find((i) => i.id === pending2)!;
    assert.notEqual(item2.id, item.id, "no repite");
    const wrong = await say(item2.isSmoke ? "limpio" : "humo");
    assert.match(wrong.title, /Casi/);
    assert.match((await say("/progreso")).summary!, /Respondiste 2, acertaste 1/);
    // "humo" sin pregunta pendiente se analiza como cualquier texto.
    assert.notEqual((await say("humo")).title, "¡Bien!");
  });

  test("aulas: docente de una escuela, estudiantes con apodo, informe sin datos de contacto", async () => {
    const t = await testPlatform();
    const school = await org(t, "educacion", "school");
    const teacher = await school.member("teacher");
    await assert.rejects(t.p.inclusion.learning.createClassroom({ teacherId: (await school.member()).id, name: "3° B" }), AccessDeniedError);
    const c = await t.p.inclusion.learning.createClassroom({ teacherId: teacher.id, name: "3° B" });
    assert.match(c.joinCode, /^[0-9A-F]{6}$/);

    const say = async (from: string, text: string) => {
      t.clock.advance(60_000);
      return (await t.p.inbound.execute(wa(from, text, t.clock.now()))).response;
    };
    assert.match((await say("+5491155550201", `/aula ${c.joinCode} 1155550201`)).summary!, /apodo/);
    assert.match((await say("+5491155550201", `/aula ${c.joinCode} Lu`)).title, /Entraste al aula "3° B" como Lu/);
    await say("+5491155550202", `/aula ${c.joinCode} Tomi`);
    await say("+5491155550201", "/jugar");
    await say("+5491155550201", "humo");

    const rep = await t.p.inclusion.learning.report({ teacherId: teacher.id, classroomId: c.id });
    assert.deepEqual(rep.students.map((s) => s.alias), ["Lu", "Tomi"]);
    assert.equal(rep.students[0]!.answered, 1);
    assert.equal(rep.leaderboard, undefined, "ranking apagado por defecto");
    assert.ok(!JSON.stringify(rep).includes("+54911"), "el docente nunca ve teléfonos");
    await assert.rejects(t.p.inclusion.learning.report({ teacherId: (await school.member()).id, classroomId: c.id }), NotFoundError);

    const company = await org(t, "equipo");
    await t.store.repos.users.save({ ...company.admin, roleIds: [...company.admin.roleIds, "teacher"] });
    await assert.rejects(t.p.inclusion.learning.createClassroom({ teacherId: company.admin.id, name: "x" }), (e: AccessDeniedError) => e.code === "feature_not_in_plan");
  });
});

describe("Lectura fácil y audio", () => {
  test("lectura fácil: frases simples, sin jerga, lo importante primero", async () => {
    const t = await testPlatform();
    const from = "+5491166660001";
    await t.p.inbound.execute(wa(from, "/formato fácil", t.clock.now()));
    t.clock.advance(60_000);
    const r = (await t.p.inbound.execute(wa(from, CHAIN, t.clock.now()))).response;
    assert.equal(r.sections[0]?.heading, "Lo importante");
    const all = JSON.stringify(r);
    assert.doesNotMatch(all, /Adjetivo inflado|Índice de humo/i);
    assert.ok(r.sections[0]!.lines.length <= 5);
  });

  test("audio: con plan y preferencia; link firmado que vence; se puede apagar con la función en prueba", async () => {
    const t = await testPlatform();
    const from = "+5491166660002";
    const u = await userWithPlan(t, "personal", ["reader"], from);
    await t.p.inbound.execute(wa(from, "/audio si", t.clock.now()));
    t.clock.advance(60_000);
    const r = (await t.p.inbound.execute(wa(from, CHAIN, t.clock.now()))).response;
    assert.ok(r.audio, "trae audio");
    assert.equal(t.whatsapp.outbox.at(-1)!.audio?.url, r.audio!.url);
    assert.ok(t.tts.calls.at(-1)!.length <= 1500);
    const url = new URL(r.audio!.url);
    const id = url.pathname.split("/").at(-1)!;
    const got = await t.p.inclusion.media.get(id, url.searchParams.get("sig")!, Number(url.searchParams.get("exp")));
    assert.match(got!.data.toString(), /^AUDIO:/);
    assert.equal(await t.p.inclusion.media.get(id, "firma-falsa", Number(url.searchParams.get("exp"))), undefined);
    t.clock.advance(8 * 86_400_000);
    assert.equal(await t.p.inclusion.media.get(id, url.searchParams.get("sig")!, Number(url.searchParams.get("exp"))), undefined, "vence");

    const a = await admin(t);
    await t.p.flags.update({ actorId: a.id, key: "audio_replies", enabled: false });
    t.clock.advance(60_000);
    assert.equal((await t.p.inbound.execute(wa(from, `${CHAIN} bis`, t.clock.now()))).response.audio, undefined, "apagado de emergencia");

    const free = "+5491166660003";
    await t.p.inbound.execute(wa(free, "/audio si", t.clock.now()));
    t.clock.advance(60_000);
    assert.equal((await t.p.inbound.execute(wa(free, CHAIN, t.clock.now()))).response.audio, undefined, "el plan gratis no incluye audio");
    assert.equal(u.status, "active");
  });

  test("accesibilidad: tarjetas SVG con título, descripción e idioma", async () => {
    const card = await new SvgCardGenerator().card({ title: "El gas no sube 300%", body: "El aumento aprobado es de 30%.", footer: "Fuente: Resolución 45" });
    assert.match(card.data, /role="img"/);
    assert.match(card.data, /<title id="t">El gas no sube 300%<\/title>/);
    assert.match(card.data, /<desc id="d">[^<]*Resolución 45<\/desc>/);
    assert.match(card.data, /lang="es"/);
  });
});

describe("Funciones en prueba (feature flags)", () => {
  test("despliegue gradual estable, por organización, por plan y apagado de emergencia", async () => {
    const f: FeatureFlag = { key: "nuevo", description: "", enabled: true, rolloutPercent: 30, allowUsers: ["vip"], allowOrgs: [], plans: [], countries: [], updatedAt: new Date(), updatedBy: "x" };
    const on = Array.from({ length: 1000 }, (_, i) => evaluateFlag(f, { userId: `u${i}` })).filter(Boolean).length;
    assert.ok(on > 230 && on < 370, `~30% (${on})`);
    assert.equal(evaluateFlag(f, { userId: "u7" }), evaluateFlag(f, { userId: "u7" }), "estable");
    assert.equal(evaluateFlag(f, { userId: "vip" }), true);
    assert.equal(evaluateFlag({ ...f, enabled: false }, { userId: "vip" }), false, "apagado gana");
    assert.equal(evaluateFlag({ ...f, rolloutPercent: 100, plans: ["empresa"] }, { userId: "x", planId: "gratis" }), false);
    const orgBucket = bucketOf("nuevo", "org_1");
    assert.equal(evaluateFlag({ ...f, rolloutPercent: orgBucket + 1 }, { userId: "a", organizationId: "org_1" }), evaluateFlag({ ...f, rolloutPercent: orgBucket + 1 }, { userId: "b", organizationId: "org_1" }), "toda la organización junta");

    const t = await testPlatform();
    await assert.rejects(t.p.flags.update({ actorId: (await userWithPlan(t, "empresa")).id, key: "audio_replies", enabled: false }), AccessDeniedError);
    const a = await admin(t);
    await assert.rejects(t.p.flags.update({ actorId: a.id, key: "no_existe", enabled: true }), NotFoundError);
    assert.equal(await t.p.flags.isEnabled("no_existe", {}), false);
    await t.p.flags.update({ actorId: a.id, key: "referrals", rolloutPercent: 0 });
    assert.equal(await t.p.flags.isEnabled("referrals", { userId: "cualquiera" }), false);
    assert.ok((await t.store.repos.audit.find({ action: "feature_flag.changed" })).length >= 1);
  });
});

describe("Soporte con tickets", () => {
  test("abrir por chat, prioridad por plan, respuesta del equipo, notas internas, plazos y calificación", async () => {
    const t = await testPlatform();
    const from = "+5491177770001";
    const u = await userWithPlan(t, "empresa", ["reader"], from);
    void u;
    const say = async (text: string) => {
      t.clock.advance(60_000);
      return (await t.p.inbound.execute(wa(from, text, t.clock.now()))).response;
    };
    const opened = await say("/soporte No me llegó la factura de septiembre");
    const id = opened.title.match(/T-[A-Z0-9]+/)![0];
    let ticket = (await t.store.repos.tickets.findById(id))!;
    assert.equal(ticket.category, "billing");
    assert.equal(ticket.priority, "high", "plan Empresa: prioridad alta, 4 h");
    assert.equal(ticket.firstResponseDueAt.getTime() - ticket.createdAt.getTime(), 4 * 3_600_000);
    assert.match((await say("/soporte Es la del día 1")).title, /Sumamos tu mensaje/);

    const agent = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["support_agent"]);
    await assert.rejects(t.p.support.queue((await userWithPlan(t, "gratis")).id), AccessDeniedError);
    await t.p.support.reply({ agentId: agent.id, ticketId: id, text: "Revisar con ARCA", internal: true });
    const before = t.whatsapp.outbox.length;
    await t.p.support.reply({ agentId: agent.id, ticketId: id, text: "Te la reenviamos por mail.", status: "solved" });
    // Se le acababa de escribir: el aviso espera un minuto (límite por destinatario) y sale solo.
    t.clock.advance(61_000);
    await t.p.jobs.worker().runOnce();
    assert.ok(t.whatsapp.outbox.slice(before).some((m) => m.to === from), "la persona recibe la respuesta");
    const mine = await t.p.support.listMine(ticket.requesterId);
    assert.ok(!JSON.stringify(mine).includes("Revisar con ARCA"), "no ve las notas internas");
    await t.p.support.rate({ userId: ticket.requesterId, ticketId: id, score: 5 });
    ticket = (await t.store.repos.tickets.findById(id))!;
    assert.equal(ticket.satisfaction, 5);
    assert.ok(ticket.firstRespondedAt);
  });

  test("vencidos se escalan; datos personales y reclamos de medios tienen prioridad; borrar cuenta anonimiza", async () => {
    const t = await testPlatform();
    const free = await userWithPlan(t, "gratis");
    const a = await t.p.support.open({ userId: free.id, text: "La app no funciona cuando comparo", channel: "web" });
    assert.deepEqual([a.category, a.priority], ["bug", "low"]);
    const d = await t.p.support.open({ userId: free.id, text: "Quiero borrar mi cuenta y mis datos personales", channel: "web" });
    assert.deepEqual([d.category, d.priority], ["data_request", "high"]);
    assert.equal(guessCategory("Pido réplica por la evaluación de mi medio"), "content_dispute");

    t.clock.advance(49 * 3_600_000);
    assert.equal(await t.p.support.checkSla(), 2);
    const late = (await t.store.repos.tickets.findById(a.id))!;
    assert.deepEqual([late.slaBreached, late.priority], [true, "normal"]);

    await t.p.privacy.personalData.deleteMyData({ userId: free.id, confirmation: "BORRAR MIS DATOS" });
    const anon = (await t.store.repos.tickets.findById(a.id))!;
    assert.equal(anon.requesterId, "borrado");
    assert.ok(!JSON.stringify(anon).includes("no funciona"));
  });
});

/** Mudar suscriptores de un plan a otro: aviso previo, fecha, período ya pagado y precio nuevo desde el próximo cobro. */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { drainJobs, testPlatform, userWithPlan } from "./helpers/platform";
import { post, startWebApi } from "./helpers/webSession";

const DAY = 86_400_000;
type M = { id: string; status: string; notified: number; effectiveAt: string; applied?: { subscriptions: number } };

describe("Planes: mudar suscriptores", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let web: Awaited<ReturnType<typeof startWebApi>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof startWebApi>>["login"]>>;
  const inDays = (d: number) => new Date(t.clock.now().getTime() + d * DAY).toISOString();
  const sentTo = (address: string) => JSON.stringify(t.whatsapp.outbox.filter((m) => JSON.stringify(m).includes(address)));

  before(async () => {
    t = await testPlatform();
    web = await startWebApi(t);
    admin = await web.login("admin.mudanzas@correo.example", ["platform_admin"]);
    // Plan nuevo, más caro, copiado de Personal.
    assert.equal((await admin("/v1/admin/plans", post({ basedOn: "personal", name: "Personal 2027", description: "", monthlyAmount: 6_990, yearlyAmount: null, tier: 1 }))).status, 201);
  });
  after(() => web.close());

  test("sólo quien administra planes; reglas de la mudanza", async () => {
    const reader = await web.login("lector.mudanzas@correo.example");
    assert.equal((await reader("/v1/admin/plan-migrations")).status, 403);
    assert.equal((await admin("/v1/admin/plan-migrations", post({ fromPlanId: "empresa", toPlanId: "equipo", effectiveAt: inDays(40) }))).status, 409, "sin suscriptores");
    await userWithPlan(t, "equipo");
    assert.equal((await admin("/v1/admin/plan-migrations", post({ fromPlanId: "equipo", toPlanId: "personal", effectiveAt: inDays(40) }))).status, 400, "otro público");
    assert.equal((await admin("/v1/admin/plan-migrations", post({ fromPlanId: "equipo", toPlanId: "gratis", effectiveAt: inDays(40) }))).status, 400, "al gratis no");
    assert.equal((await admin("/v1/admin/plan-migrations", post({ fromPlanId: "equipo", toPlanId: "equipo", effectiveAt: inDays(40) }))).status, 400);
  });

  test("más caro: al menos 30 días de aviso; se avisa, el viejo sale de la venta; en la fecha se muda conservando el período", async () => {
    const phone = "+5491133330001";
    const payer = await userWithPlan(t, "personal", ["reader"], phone);
    const cur = (await t.store.repos.subscriptions.findCurrent({ type: "user", id: payer.id }))!;
    const periodEnd = new Date(t.clock.now().getTime() + 50 * DAY);
    await t.store.repos.subscriptions.save({ ...cur, interval: "month", charged: { amount: 4_490, currency: "ARS", listAmount: 4_990, couponCode: "BIENVENIDA" }, currentPeriodEnd: periodEnd });
    const leaving = await userWithPlan(t, "personal", ["reader"], "+5491133330002");
    const leavingSub = (await t.store.repos.subscriptions.findCurrent({ type: "user", id: leaving.id }))!;
    await t.store.repos.subscriptions.save({ ...leavingSub, cancelAtPeriodEnd: true });

    const notice = (await (await admin("/v1/admin/plan-migrations/notice?from=personal&to=personal-2027")).json()) as { days: number };
    assert.equal(notice.days, 30);
    const early = await admin("/v1/admin/plan-migrations", post({ fromPlanId: "personal", toPlanId: "personal-2027", effectiveAt: inDays(10) }));
    assert.equal(early.status, 400);
    assert.match(((await early.json()) as { error: string }).error, /30 días/);

    const r = await admin("/v1/admin/plan-migrations", post({ fromPlanId: "personal", toPlanId: "personal-2027", effectiveAt: inDays(31), message: "Sumamos el archivo de notas." }));
    assert.equal(r.status, 201);
    const m = (await r.json()) as M;
    assert.ok(m.notified >= 1);
    assert.match(sentTo(phone), /pasa a ser Personal 2027/);
    assert.match(sentTo(phone), /ARS 6\.990\/mes/);
    assert.match(sentTo(phone), /darte de baja sin costo/);
    assert.match(sentTo(phone), /Sumamos el archivo de notas/);
    assert.equal((await t.store.repos.plans.findById("personal"))!.forSale, false, "nadie entra sin enterarse");
    assert.equal((await admin("/v1/admin/plan-migrations", post({ fromPlanId: "personal", toPlanId: "personal-2027", effectiveAt: inDays(60) }))).status, 409, "una sola por plan");

    assert.deepEqual(await t.p.commerce.migrations.applyDue(), { migrations: 0, subscriptions: 0 }, "antes de la fecha, nada");
    t.clock.advance(32 * DAY);
    admin = await web.login("admin.mudanzas@correo.example"); // (la sesión dura 30 días)
    const res = await t.p.commerce.migrations.applyDue();
    assert.equal(res.migrations, 1);

    const moved = (await t.store.repos.subscriptions.findCurrent({ type: "user", id: payer.id }))!;
    assert.equal(moved.planId, "personal-2027");
    assert.equal(moved.currentPeriodEnd.toISOString(), periodEnd.toISOString(), "conserva el período ya pagado");
    assert.deepEqual([moved.charged!.listAmount, moved.charged!.couponCode], [6_990, undefined], "precio de lista del nuevo, sin el cupón del viejo");
    assert.equal(moved.migratedFrom!.migrationId, m.id);
    assert.equal((await t.store.repos.subscriptions.findCurrent({ type: "user", id: leaving.id }))!.planId, "personal", "quien canceló no se muda");

    const list = (await (await admin("/v1/admin/plan-migrations")).json()) as M[];
    assert.equal(list.find((x) => x.id === m.id)!.status, "applied");
    const audit = (await (await admin("/v1/audit?action=plan.migration_applied")).json()) as { target: { id: string } }[];
    assert.ok(audit.some((e) => e.target.id === m.id));
  });

  test("igual o mejor: puede ser enseguida; y se puede cancelar avisando", async () => {
    const phone = "+5491133330003";
    await userWithPlan(t, "profesional", ["reader"], phone);
    // Profesional → un plan igual al Profesional pero más barato: no hace falta aviso.
    assert.equal((await admin("/v1/admin/plans", post({ basedOn: "profesional", name: "Profesional Promo", description: "", monthlyAmount: 9_990, yearlyAmount: null, tier: 2 }))).status, 201);
    const notice = (await (await admin("/v1/admin/plan-migrations/notice?from=profesional&to=profesional-promo")).json()) as { days: number };
    assert.equal(notice.days, 0);
    const m = (await (await admin("/v1/admin/plan-migrations", post({ fromPlanId: "profesional", toPlanId: "profesional-promo", effectiveAt: inDays(1) }))).json()) as M;
    assert.equal(m.status, "scheduled");

    const c = await admin(`/v1/admin/plan-migrations/${m.id}/cancel`, post({}));
    assert.equal(c.status, 200);
    // (el aviso anterior salió recién: por el límite por persona, éste se reintenta al minuto, no se pierde)
    t.clock.advance(61_000);
    await drainJobs(t);
    assert.match(sentTo(phone), /no cambia/);
    assert.equal((await admin(`/v1/admin/plan-migrations/${m.id}/cancel`, post({}))).status, 409);
    t.clock.advance(2 * DAY);
    await t.p.commerce.migrations.applyDue();
    const sub = (await t.store.repos.subscriptions.findLiveByPlan("profesional", 100)).length;
    assert.ok(sub >= 1, "cancelada: nadie se mudó");
  });
});

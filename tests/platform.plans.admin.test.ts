/** Planes desde el backoffice: precios, límites y funciones; nunca se le quita algo a quien ya paga. */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { seedPlatform } from "../src/composition/platform";
import { testPlatform, userWithPlan } from "./helpers/platform";
import { post, startWebApi } from "./helpers/webSession";

type P = { id: string; name: string; price: { amount: number } | null; yearlyPrice?: { amount: number }; features: string[]; limits: Record<string, number | null>; liveSubscriptions: number; customized?: unknown };

describe("Web: planes", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let web: Awaited<ReturnType<typeof startWebApi>>;
  const patchOf = (p: P, over: Partial<Record<string, unknown>> = {}) => ({
    name: p.name, description: "Para medios chicos", monthlyAmount: p.price?.amount, yearlyAmount: p.yearlyPrice?.amount ?? null, features: p.features, limits: p.limits, ...over,
  });

  before(async () => {
    t = await testPlatform();
    web = await startWebApi(t);
  });
  after(() => web.close());

  test("sólo quien administra planes", async () => {
    const reader = await web.login("lector.planes@correo.example");
    assert.equal((await reader("/v1/admin/plans")).status, 403);
    assert.equal((await reader("/v1/admin/plans/personal", post({ name: "x" }))).status, 403);
  });

  test("cambiar precio y sumar funciones: vale para las nuevas; el arranque no lo pisa; se puede volver al código", async () => {
    const admin = await web.login("admin.planes@correo.example", ["platform_admin"]);
    const subscriber = await userWithPlan(t, "personal");
    await t.store.repos.subscriptions.save({ ...(await t.store.repos.subscriptions.findCurrent({ type: "user", id: subscriber.id }))!, charged: { amount: 4_990, currency: "ARS", listAmount: 4_990 } });

    const plans = ((await (await admin("/v1/admin/plans")).json()) as { plans: P[] }).plans;
    const personal = plans.find((p) => p.id === "personal")!;
    assert.ok(personal.liveSubscriptions >= 1);

    const r = await admin("/v1/admin/plans/personal", post(patchOf(personal, { monthlyAmount: 5_990, features: [...personal.features, "evidence_archive"] })));
    assert.equal(r.status, 200);
    const saved = (await r.json()) as P;
    assert.equal(saved.price!.amount, 5_990);
    assert.ok(saved.features.includes("evidence_archive") && saved.customized);
    const sub = (await t.store.repos.subscriptions.findCurrent({ type: "user", id: subscriber.id }))!;
    assert.equal(sub.charged!.amount, 4_990, "quien ya paga sigue con lo contratado");

    await seedPlatform(t.store);
    assert.equal((await t.store.repos.plans.findById("personal"))!.price!.amount, 5_990, "el arranque no pisa lo editado");

    // Volver al código le quitaría evidence_archive a quien ya lo tiene: no se puede con suscripciones vigentes.
    assert.equal((await admin("/v1/admin/plans/personal/reset", post({}))).status, 409);
  });

  test("con suscripciones vigentes no se quita nada; sin ellas, sí", async () => {
    const admin = await web.login("admin.planes2@correo.example", ["platform_admin"]);
    const plans = ((await (await admin("/v1/admin/plans")).json()) as { plans: P[] }).plans;
    const pro = plans.find((p) => p.id === "profesional")!;
    await userWithPlan(t, "profesional");
    const fewer = await admin("/v1/admin/plans/profesional", post(patchOf(pro, { features: pro.features.filter((f) => f !== "webhooks") })));
    assert.equal(fewer.status, 409);
    assert.match(((await fewer.json()) as { error: string }).error, /webhooks/);
    assert.equal((await admin("/v1/admin/plans/profesional", post(patchOf(pro, { limits: { ...pro.limits, maxAlerts: 1 } })))).status, 409, "bajar un límite también");

    const empresa = plans.find((p) => p.id === "empresa")!;
    assert.equal(empresa.liveSubscriptions, 0);
    const r = await admin("/v1/admin/plans/empresa", post(patchOf(empresa, { limits: { ...empresa.limits, seats: 50 } })));
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as P).limits.seats, 50);
    assert.equal((await admin("/v1/admin/plans/empresa/reset", post({}))).status, 200);
    assert.equal((await t.store.repos.plans.findById("empresa"))!.customized, undefined);
  });

  test("datos inválidos: 400; un plan gratis sigue gratis", async () => {
    const admin = await web.login("admin.planes3@correo.example", ["platform_admin"]);
    const plans = ((await (await admin("/v1/admin/plans")).json()) as { plans: P[] }).plans;
    const e = plans.find((p) => p.id === "empresa")!;
    for (const over of [{ features: ["inventada"] }, { limits: { ...e.limits, seats: -1 } }, { limits: { ...e.limits, seats: 1.5 } }, { monthlyAmount: 0 }, { name: "" }, { limits: {} }]) {
      assert.equal((await admin("/v1/admin/plans/empresa", post(patchOf(e, over)))).status, 400, JSON.stringify(over));
    }
    const free = plans.find((p) => p.id === "gratis")!;
    const r = (await (await admin("/v1/admin/plans/gratis", post(patchOf(free, { monthlyAmount: 999 })))).json()) as P;
    assert.equal(r.price, null);
  });

  test("reemplazar un plan: uno nuevo (copiado, con menos funciones) y el viejo fuera de venta; quien lo tiene lo conserva", async () => {
    const admin = await web.login("admin.planes4@correo.example", ["platform_admin"]);
    const subscriber = await userWithPlan(t, "profesional");
    const base = { basedOn: "profesional", name: "Profesional 2027", description: "Sin webhooks", monthlyAmount: 17_990, yearlyAmount: null, tier: 2 };
    for (const bad of [{ ...base, basedOn: "no-existe" }, { ...base, tier: 1.5 }, { ...base, monthlyAmount: 0 }, { ...base, name: "  " }]) {
      assert.ok([400, 404].includes((await admin("/v1/admin/plans", post(bad))).status), JSON.stringify(bad));
    }
    const created = await admin("/v1/admin/plans", post({ ...base, id: "elegido", features: ["todo"] }));
    assert.equal(created.status, 201);
    const plan = (await created.json()) as P & { audience: string };
    assert.equal(plan.id, "profesional-2027");
    const pro = (await t.store.repos.plans.findById("profesional"))!;
    assert.deepEqual(plan.features, pro.features, "parte de las funciones del plan base");
    assert.equal(plan.yearlyPrice, undefined);
    assert.equal((await admin("/v1/admin/plans", post(base))).status, 409, "mismo nombre: ya existe");

    // Sin suscripciones, al plan nuevo se le puede quitar lo que sea.
    const trimmed = await admin(`/v1/admin/plans/${plan.id}`, post(patchOf(plan, { features: plan.features.filter((f) => f !== "webhooks") })));
    assert.equal(trimmed.status, 200);

    assert.equal((await admin("/v1/admin/plans/gratis/for-sale", post({ forSale: false }))).status, 409, "el gratis siempre se ofrece");
    assert.equal((await admin("/v1/admin/plans/profesional/for-sale", post({ forSale: false }))).status, 200);
    const offered = ((await (await fetch(`${web.base}/public/plans`)).json()) as { id: string }[]).map((p) => p.id);
    assert.ok(!offered.includes("profesional") && offered.includes("profesional-2027"));

    const buyer = await web.login("compradora.planes@correo.example");
    assert.equal((await buyer("/v1/checkout", post({ planId: "profesional" }))).status, 400, "no se puede elegir");
    assert.equal((await t.store.repos.subscriptions.findCurrent({ type: "user", id: subscriber.id }))!.planId, "profesional", "quien lo tiene lo conserva");

    await seedPlatform(t.store);
    assert.equal((await t.store.repos.plans.findById("profesional"))!.forSale, false, "el arranque no lo vuelve a poner en venta");
    assert.equal((await admin("/v1/admin/plans/profesional/for-sale", post({ forSale: true }))).status, 200);
    assert.ok(((await (await fetch(`${web.base}/public/plans`)).json()) as { id: string }[]).some((p) => p.id === "profesional"));
  });
});

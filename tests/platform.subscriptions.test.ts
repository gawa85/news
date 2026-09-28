/** Ciclo de vida de la suscripción: cancelar, retomar y vencer (sin dejar a nadie bloqueado). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { AccessDeniedError, ValidationError } from "../src/domain/errors";
import { FakeRecurringCharges } from "../src/infrastructure/billing/Payments";
import { testPlatform, userWithPlan } from "./helpers/platform";

async function lifecyclePlatform() {
  const recurring = new FakeRecurringCharges();
  const t = await testPlatform({ extra: { recurringCharges: recurring } });
  return { t, recurring };
}

const planOf = async (t: Awaited<ReturnType<typeof testPlatform>>, userId: string) => (await t.p.access.planOf((await t.store.repos.users.findById(userId))!)).plan.id;

describe("Suscripción: cancelar y retomar", () => {
  test("cancelar sigue hasta el fin del período pagado y le avisa al proveedor; se puede retomar", async () => {
    const { t, recurring } = await lifecyclePlatform();
    const u = await userWithPlan(t, "personal");
    const c = await t.p.billing.lifecycle.cancel({ actorId: u.id });
    assert.equal(c.cancelAtPeriodEnd, true);
    assert.equal(c.status, "active");
    assert.deepEqual(recurring.stopped, [c.id]);
    assert.equal(await planOf(t, u.id), "personal", "hasta el fin del período, sigue con su plan");

    const again = await t.p.billing.lifecycle.cancel({ actorId: u.id });
    assert.equal(again.canceledAt!.getTime(), c.canceledAt!.getTime(), "cancelar dos veces no cambia nada");

    const r = await t.p.billing.lifecycle.resume({ actorId: u.id });
    assert.equal(r.cancelAtPeriodEnd, false);
    assert.deepEqual(recurring.resumed, [c.id]);
    const audit = (await t.store.repos.audit.find({ actorId: u.id })).map((e) => e.action);
    assert.ok(audit.includes("subscription.canceled") && audit.includes("subscription.resumed"));
  });

  test("el plan gratis no se cancela; en una organización sólo cancela quien administra", async () => {
    const { t } = await lifecyclePlatform();
    const free = await userWithPlan(t, "gratis");
    await assert.rejects(t.p.billing.lifecycle.cancel({ actorId: free.id }), ValidationError);

    const owner = await userWithPlan(t, "gratis");
    const org = await t.p.users.createOrganization.execute({ ownerId: owner.id, name: "Diario Norte" });
    const member = await userWithPlan(t, "gratis");
    await t.store.repos.users.save({ ...member, organizationId: org.id });
    await assert.rejects(t.p.billing.lifecycle.cancel({ actorId: member.id }), AccessDeniedError);
  });
});

describe("Suscripción: vencer", () => {
  test("al terminar el período, la persona pasa al plan gratis (antes quedaba bloqueada) y se le avisa", async () => {
    const { t } = await lifecyclePlatform();
    const address = "+5491133334444";
    const canceled = await userWithPlan(t, "personal", ["reader"], address);
    await t.p.billing.lifecycle.cancel({ actorId: canceled.id });
    const notRenewed = await userWithPlan(t, "profesional");

    t.clock.set(new Date("2027-01-02T12:00:00Z")); // userWithPlan pone el fin del período el 01/01/2027
    const r = await t.p.billing.lifecycle.expireDue();
    assert.ok(r.expired >= 2);
    assert.ok(r.downgraded >= 2);
    assert.equal(await planOf(t, canceled.id), "gratis");
    assert.equal(await planOf(t, notRenewed.id), "gratis");

    // Puede seguir usando el producto (antes: "Tu suscripción no está activa").
    const now = t.clock.now();
    const a = await t.p.gateway.analyzeContent({ userId: notRenewed.id, channel: "web" }, { id: "x", sourceType: "message", origin: {}, text: "Hola", urls: [], publishedAt: now, receivedAt: now, attachments: [], metadata: {} });
    assert.ok(a.id);

    const events = await t.store.repos.audit.find({ action: "subscription.expired" });
    const reasons = events.map((e) => e.data.reason).sort();
    assert.ok(reasons.includes("canceled") && reasons.includes("not_renewed"));
    assert.ok(t.whatsapp.outbox.some((m) => m.to === address && /Terminó tu plan Personal/.test(m.text)));

    assert.deepEqual(await t.p.billing.lifecycle.expireDue(), { expired: 0, downgraded: 0 }, "lo ya vencido no se vuelve a procesar");
  });

  test("una organización vencida no pasa a un plan de personas: espera que su administración elija", async () => {
    const { t } = await lifecyclePlatform();
    const owner = await userWithPlan(t, "gratis");
    const org = await t.p.users.createOrganization.execute({ ownerId: owner.id, name: "Consultora Sur" });
    t.clock.set(new Date(t.clock.now().getTime() + 15 * 86_400_000)); // la prueba gratuita dura 14 días
    await t.p.billing.lifecycle.expireDue();
    const sub = await t.store.repos.subscriptions.findCurrent({ type: "organization", id: org.id });
    assert.equal(sub!.status, "canceled");
  });

  test("/v1/me muestra si se renueva o termina", async () => {
    const { t } = await lifecyclePlatform();
    const u = await userWithPlan(t, "personal");
    await t.p.billing.lifecycle.cancel({ actorId: u.id });
    const deps = httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } });
    const me = await deps.account!.me(u.id);
    assert.equal(me.subscription!.cancelAtPeriodEnd, true);
    assert.equal(me.subscription!.currentPeriodEnd.toISOString(), "2027-01-01T00:00:00.000Z");
  });
});

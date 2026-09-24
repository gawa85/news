/** Roles, planes, cuotas, reglas de usuario/organización y claves de API. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AccessDeniedError, ConflictError } from "../src/domain/errors";
import { testPlatform, userWithPlan } from "./helpers/platform";

const march = { from: new Date("2026-03-01T03:00:00Z"), to: new Date("2026-04-01T02:59:59Z") };

describe("Planes y cuotas", () => {
  test("el plan gratuito corta en el 6º análisis del día y sugiere el plan que lo resuelve", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "gratis");
    for (let i = 0; i < 5; i++) await t.p.gateway.analyzeSmoke({ userId: u.id, channel: "whatsapp" }, "Es histórico: sube 10%.");
    await assert.rejects(t.p.gateway.analyzeSmoke({ userId: u.id, channel: "whatsapp" }, "otro"), (e: AccessDeniedError) => {
      assert.equal(e.code, "quota_exceeded");
      assert.match(e.upgradeHint ?? "", /Personal/);
      return true;
    });
    // Al día siguiente (hora argentina) se renueva la cuota.
    t.clock.advance(24 * 3600_000);
    await t.p.gateway.analyzeSmoke({ userId: u.id, channel: "whatsapp" }, "Sube 10%.");
  });

  test("una funcionalidad fuera del plan se deniega con sugerencia de upgrade", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "gratis");
    await assert.rejects(
      t.p.gateway.evaluateCredibility({ userId: u.id, channel: "web" }, { outletId: "ddv", topic: "tarifas de gas", period: march }),
      (e: AccessDeniedError) => e.code === "feature_not_in_plan" && /Personal/.test(e.upgradeHint ?? ""),
    );
  });

  test("el canal tiene que estar en el plan (API sólo desde Profesional)", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "personal");
    await assert.rejects(t.p.gateway.analyzeSmoke({ userId: u.id, channel: "api" }, "x"), (e: AccessDeniedError) => e.code === "channel_not_in_plan" && /Profesional/.test(e.upgradeHint ?? ""));
  });

  test("el plan limita cuántos medios entran en una comparación", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "gratis");
    const r = await t.p.gateway.compareSources({ userId: u.id, channel: "web" }, { topic: "tarifas de gas", period: march });
    assert.ok(r.outletIds.length <= 4);
  });

  test("upgrade: queda pendiente de pago sin cortar el servicio, y se activa al confirmar", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "gratis");
    const { subscription, checkoutUrl } = await t.p.users.changePlan.execute({ actorId: u.id, planId: "personal" });
    assert.equal(subscription.status, "pending_payment");
    assert.ok(checkoutUrl);
    assert.equal((await t.p.access.planOf(u)).plan.id, "gratis");
    await t.p.users.confirmPayment.execute({ subscriptionId: subscription.id });
    await t.p.users.confirmPayment.execute({ subscriptionId: subscription.id }); // idempotente
    assert.equal((await t.p.access.planOf(u)).plan.id, "personal");
  });
});

describe("Roles y organizaciones", () => {
  test("el admin de una organización no puede dar roles de plataforma ni escalar privilegios", async () => {
    const t = await testPlatform();
    const admin = await userWithPlan(t, "gratis");
    const org = await t.p.users.createOrganization.execute({ ownerId: admin.id, name: "Consultora" });
    const member = await userWithPlan(t, "gratis");
    member.organizationId = org.id;
    await t.store.repos.users.save(member);

    await t.p.users.roles.assign({ actorId: admin.id, targetId: member.id, roleId: "moderator" });
    await assert.rejects(t.p.users.roles.assign({ actorId: admin.id, targetId: member.id, roleId: "platform_admin" }), AccessDeniedError);
    const outsider = await userWithPlan(t, "gratis");
    await assert.rejects(t.p.users.roles.assign({ actorId: admin.id, targetId: outsider.id, roleId: "analyst" }), /tu organización/);
    // El último administrador no puede quitarse el rol.
    await assert.rejects(t.p.users.roles.remove({ actorId: admin.id, targetId: admin.id, roleId: "org_admin" }), /último administrador/);
  });

  test("downgrade bloqueado si hay más miembros que asientos", async () => {
    const t = await testPlatform();
    const admin = await userWithPlan(t, "gratis");
    const org = await t.p.users.createOrganization.execute({ ownerId: admin.id, name: "Medio grande" });
    for (let i = 0; i < 10; i++) {
      const m = await userWithPlan(t, "gratis");
      m.organizationId = org.id;
      await t.store.repos.users.save(m);
    }
    await assert.rejects(t.p.users.changePlan.execute({ actorId: admin.id, planId: "equipo" }), ConflictError);
  });

  test("las exclusiones de la organización son obligatorias; las personales ceden ante un include explícito", async () => {
    const t = await testPlatform();
    const admin = await userWithPlan(t, "gratis");
    await t.p.users.createOrganization.execute({ ownerId: admin.id, name: "Org" });
    await t.p.users.saveRules.execute({ actorId: admin.id, scope: "organization", name: "Bloqueos", urlRules: { exclude: ["opinionesya.example"] } });
    await t.p.users.saveRules.execute({ actorId: admin.id, scope: "user", name: "Mías", urlRules: { exclude: ["revista-energia.example"] } });

    const r = await t.p.gateway.compareSources({ userId: admin.id, channel: "web" }, {
      topic: "tarifas de gas", period: march,
      urlRules: { include: ["https://opinionesya.example/opinion/caos-gas", "https://revista-energia.example/analisis/tarifas-gas-2026"] },
    });
    assert.deepEqual(r.blockedIncludes, ["https://opinionesya.example/opinion/caos-gas"]);
    assert.ok(r.articleUrls.includes("https://revista-energia.example/analisis/tarifas-gas-2026"));
    assert.ok(!r.articleUrls.some((u) => u.includes("opinionesya")));
  });
});

describe("Claves de API", () => {
  test("una clave nunca tiene más permisos que su dueño, y sus alcances limitan lo que puede hacer", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "profesional");
    await assert.rejects(t.p.integrations.apiKeys.create({ actorId: u.id, name: "bot", scopes: ["users:manage_all"] }), /no tenés/);
    const { plaintext } = await t.p.integrations.apiKeys.create({ actorId: u.id, name: "bot", scopes: ["smoke:analyze"] });
    const caller = await t.p.integrations.apiKeys.authenticate(plaintext);
    await t.p.gateway.analyzeSmoke(caller, "Sube 5%.");
    await assert.rejects(t.p.gateway.compareSources(caller, { topic: "tarifas de gas", period: march }), (e: AccessDeniedError) => e.code === "no_permission");
    await assert.rejects(t.p.integrations.apiKeys.authenticate("sh_live_falsa"), AccessDeniedError);
  });
});

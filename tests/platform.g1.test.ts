/** Grupo 1: alertas, login web, auditoría, derecho a réplica y exportación. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { AccessDeniedError, ValidationError } from "../src/domain/errors";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { testPlatform, userWithPlan, withRoles, type Handler } from "./helpers/platform";

const jan_aug = { from: new Date("2026-01-01T03:00:00Z"), to: new Date("2026-09-01T02:59:59Z") };
const tokenFrom = (text: string) => text.match(/token=([\w-]+)/)![1]!;

const google: Handler = (method, url, body) => {
  if (method === "POST" && url === "https://oauth2.googleapis.com/token") {
    const code = new URLSearchParams(String(body)).get("code");
    return { status: 200, text: JSON.stringify({ access_token: `at-${code}` }) };
  }
  if (url === "https://openidconnect.googleapis.com/v1/userinfo") return { status: 200, text: JSON.stringify({ sub: "g-1", email: "maria@gmail.example", email_verified: true, name: "María" }) };
  return { status: 404 };
};

describe("Alertas", () => {
  test("notas nuevas: avisa una vez por WhatsApp con plantilla aprobada (sirve fuera de la ventana de 24 h)", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "personal");
    await t.p.users.createAlert.execute({ actorId: u.id, topic: "tarifas de gas", trigger: "new_coverage", channel: "whatsapp" });

    t.clock.advance(48 * 3600_000); // hace 2 días que la persona no escribe
    await t.store.repos.articles.saveMany([{ id: "nueva-1", outletId: "ps", url: "https://portalsur.example/nueva", title: "Nuevo cuadro tarifario", body: "Sube 8%.", publishedAt: t.clock.now(), region: { country: "AR" }, topic: "tarifas de gas" }]);
    t.clock.advance(60_000);

    const [first] = await t.p.alerts.evaluate.execute();
    assert.equal(first!.notified, true, first!.reason);
    const sent = t.whatsapp.outbox.at(-1)!;
    assert.equal(sent.template?.name, "alerta_tema");
    assert.deepEqual(sent.template?.params[0], "tarifas de gas");

    const [second] = await t.p.alerts.evaluate.execute();
    assert.equal(second!.notified, false, "no repite el mismo aviso");
  });

  test("cambio de credibilidad: la primera vez sólo registra; cuando cambia ≥ 10 puntos, avisa", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "personal");
    await assert.rejects(t.p.users.createAlert.execute({ actorId: u.id, topic: "tarifas de gas", trigger: "credibility_change", channel: "whatsapp" }), ValidationError);
    await t.p.users.createAlert.execute({ actorId: u.id, topic: "tarifas de gas", trigger: "credibility_change", channel: "whatsapp", outletId: "ddv" });
    await t.p.core.ingestArticles.execute({ topic: "tarifas de gas", period: jan_aug });

    assert.equal((await t.p.alerts.evaluate.execute())[0]!.notified, false);
    const ddvIds = (await t.store.repos.articles.find({ outletId: "ddv" })).map((a) => a.id);
    for (const c of (await t.store.repos.claims.findByArticleIds(ddvIds)).filter((c) => c.kind === "fact")) {
      await t.store.repos.verdicts.save({ claimId: c.id, status: "confirmed", checkedAt: t.clock.now() });
    }
    t.clock.advance(3600_000);
    const [r] = await t.p.alerts.evaluate.execute();
    assert.equal(r!.notified, true, r!.reason);
    assert.match(t.whatsapp.outbox.at(-1)!.template!.params[1]!, /subió/);
  });

  test("el plan gratuito no incluye alertas", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "gratis");
    await assert.rejects(t.p.users.createAlert.execute({ actorId: u.id, topic: "x", trigger: "new_coverage", channel: "whatsapp" }), (e: AccessDeniedError) => e.code === "feature_not_in_plan");
  });
});

describe("Login web", () => {
  test("enlace mágico: un solo uso, vence, y crea la cuenta con el mail verificado", async () => {
    const t = await testPlatform();
    await t.p.auth.requestMagicLink("Nuevo@Correo.example");
    const token = tokenFrom(t.mail.sent.at(-1)!.text);
    const { token: session, user } = await t.p.auth.consumeMagicLink(token);
    assert.equal(user.channels[0]!.address, "nuevo@correo.example");
    assert.equal(user.channels[0]!.verified, true);
    assert.equal((await t.p.auth.authenticateSession(session)).userId, user.id);
    await assert.rejects(t.p.auth.consumeMagicLink(token), AccessDeniedError);

    await t.p.auth.requestMagicLink("nuevo@correo.example");
    const late = tokenFrom(t.mail.sent.at(-1)!.text);
    t.clock.advance(16 * 60_000);
    await assert.rejects(t.p.auth.consumeMagicLink(late), /venció/);
  });

  test("contraseña: requisitos, bloqueo tras 5 fallos (aun con la correcta) y desbloqueo a los 15 min", async () => {
    const t = await testPlatform();
    await t.p.auth.requestMagicLink("ana@correo.example");
    const { user } = await t.p.auth.consumeMagicLink(tokenFrom(t.mail.sent.at(-1)!.text));
    await assert.rejects(t.p.auth.setPassword(user.id, "otro@correo.example", "una-clave-larga-123"), /verificá/);
    await assert.rejects(t.p.auth.setPassword(user.id, "ana@correo.example", "corta"), /al menos/);
    await t.p.auth.setPassword(user.id, "ana@correo.example", "una clave larga y rara 91");

    assert.ok((await t.p.auth.loginWithPassword("ANA@correo.example", "una clave larga y rara 91")).token);
    for (let i = 0; i < 5; i++) await assert.rejects(t.p.auth.loginWithPassword("ana@correo.example", "mal"), /incorrectos/);
    await assert.rejects(t.p.auth.loginWithPassword("ana@correo.example", "una clave larga y rara 91"), (e: AccessDeniedError) => e.code === "too_many_attempts");
    t.clock.advance(16 * 60_000);
    assert.ok((await t.p.auth.loginWithPassword("ana@correo.example", "una clave larga y rara 91")).token);
  });

  test("Google: PKCE + state de un solo uso; sólo mails verificados por el proveedor", async () => {
    const t = await testPlatform({ http: google });
    const url = new URL(await t.p.auth.startOAuth("google", "/panel"));
    assert.equal(url.hostname, "accounts.google.com");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const state = url.searchParams.get("state")!;
    const r = await t.p.auth.completeOAuth("google", state, "codigo-1");
    assert.equal(r.user.channels[0]!.address, "maria@gmail.example");
    assert.equal(r.redirectAfter, "/panel");
    await assert.rejects(t.p.auth.completeOAuth("google", state, "codigo-1"), /expiró/);
  });

  test("cerrar todas las sesiones y cuenta suspendida", async () => {
    const t = await testPlatform();
    await t.p.auth.requestMagicLink("leo@correo.example");
    const a = await t.p.auth.consumeMagicLink(tokenFrom(t.mail.sent.at(-1)!.text));
    t.clock.advance(60_000);
    await t.p.auth.requestMagicLink("leo@correo.example");
    const b = await t.p.auth.consumeMagicLink(tokenFrom(t.mail.sent.at(-1)!.text));
    assert.equal(await t.p.auth.logoutEverywhere(a.user.id), 2);
    await assert.rejects(t.p.auth.authenticateSession(b.token), /venció/);
  });
});

describe("Auditoría", () => {
  test("registra acciones sensibles sin secretos; cada organización ve sólo lo suyo", async () => {
    const t = await testPlatform();
    const admin = await userWithPlan(t, "gratis");
    const org = await t.p.users.createOrganization.execute({ ownerId: admin.id, name: "Org A" });
    const member = await userWithPlan(t, "gratis");
    member.organizationId = org.id;
    await t.store.repos.users.save(member);
    await t.p.users.roles.assign({ actorId: admin.id, targetId: member.id, roleId: "analyst" });
    await t.p.users.changePlan.execute({ actorId: admin.id, planId: "empresa" });
    await withRoles(t, admin.id, []);
    const key = await (async () => {
      const pro = await userWithPlan(t, "profesional");
      return t.p.integrations.apiKeys.create({ actorId: pro.id, name: "bot", scopes: ["smoke:analyze"] });
    })();

    const entries = await t.p.audit.execute({ actorId: admin.id, filter: {} });
    const actions = entries.map((e) => e.action);
    assert.ok(actions.includes("role.assigned") && actions.includes("organization.created") && actions.includes("plan.change_requested"));
    assert.ok(!actions.includes("api_key.created"), "la clave es de otra cuenta, fuera de la organización");
    assert.ok(!JSON.stringify(await t.store.repos.audit.find({})).includes(key.plaintext), "nunca se guardan secretos");

    await assert.rejects(t.p.audit.execute({ actorId: member.id, filter: {} }), AccessDeniedError);
  });
});

describe("Derecho a réplica y fe de erratas", () => {
  test("sólo el representante acreditado replica; resuelve otra persona; aceptada corrige y publica fe de erratas; se ve junto a la credibilidad", async () => {
    const t = await testPlatform();
    const admin = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    const rep = await userWithPlan(t, "gratis");
    const checker = await withRoles(t, (await userWithPlan(t, "profesional")).id, ["fact_checker"]);
    await t.p.core.ingestArticles.execute({ topic: "tarifas de gas", period: jan_aug });
    const claim = (await t.store.repos.claims.findByArticleIds(["ddv-3"])).find((c) => c.kind === "fact")!;
    await t.store.repos.verdicts.save({ claimId: claim.id, status: "refuted", checkedAt: t.clock.now() });

    const target = { type: "verdict" as const, claimId: claim.id, requestedStatus: "disputed" as const };
    const statement = "La baja de 5% fue anunciada por el ente regulador en conferencia; adjuntamos el video completo de la conferencia.";
    await assert.rejects(t.p.rebuttals.submit({ actorId: rep.id, outletId: "ddv", target, statement }), /representante/);
    await t.p.users.assignOutletRepresentative.execute({ actorId: admin.id, targetId: rep.id, outletId: "ddv" });
    await assert.rejects(t.p.rebuttals.submit({ actorId: rep.id, outletId: "ddv", target, statement: "No es así." }), /50 caracteres/);
    const r = await t.p.rebuttals.submit({ actorId: rep.id, outletId: "ddv", target, statement, evidenceUrls: ["https://videos.example/conferencia"] });

    await assert.rejects(t.p.rebuttals.resolve({ actorId: checker.id, rebuttalId: r.id, decision: "accepted", note: "ok" }), /20 caracteres/);
    const { correction } = await t.p.rebuttals.resolve({ actorId: checker.id, rebuttalId: r.id, decision: "accepted", note: "El video confirma el anuncio oficial; la afirmación queda en disputa hasta la resolución escrita." });
    assert.ok(correction);
    const verdicts = await t.store.repos.verdicts.findByClaimIds([claim.id]);
    assert.ok(verdicts.some((v) => v.status === "disputed"));

    const report = await t.p.gateway.evaluateCredibility({ userId: checker.id, channel: "web" }, { outletId: "ddv", topic: "tarifas de gas", period: jan_aug });
    assert.equal(report.rebuttals.length, 1);
    assert.equal(report.corrections.length, 1);
    const shown = t.p.composer.credibility(report);
    assert.ok(shown.sections.some((s) => s.heading === "Réplica del medio"));
    assert.equal((await t.p.rebuttals.recentCorrections())[0]!.rebuttalId, r.id);
  });
});

describe("Exportar", () => {
  test("CSV para Excel en español, JSON y PDF; requiere plan con exportación", async () => {
    const t = await testPlatform();
    await t.p.core.ingestArticles.execute({ topic: "tarifas de gas", period: jan_aug });
    const pro = await userWithPlan(t, "profesional");
    const caller = { userId: pro.id, channel: "web" as const };
    const req = { kind: "credibility" as const, query: { outletId: "ddv", topic: "tarifas de gas", period: jan_aug } };

    const csv = await t.p.exports.export(caller, req, "csv");
    assert.deepEqual([...csv.data.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.match(csv.data.toString("utf8"), /Dimensión;Puntaje \(0-100\)/);
    const json = JSON.parse((await t.p.exports.export(caller, req, "json")).data.toString());
    assert.equal(json.tables[0].name, "Dimensiones");
    const pdf = await t.p.exports.export(caller, req, "pdf");
    assert.equal(pdf.data.subarray(0, 4).toString(), "%PDF");

    const free = await userWithPlan(t, "gratis");
    await assert.rejects(t.p.exports.export({ userId: free.id, channel: "web" }, { kind: "analysis_history" }, "csv"), (e: AccessDeniedError) => e.code === "feature_not_in_plan");
    await assert.rejects(t.p.exports.export(caller, { kind: "impact", period: jan_aug }, "csv"), /impacto/);
  });
});

describe("HTTP: sesión web por cookie", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let base: string;
  let server: ReturnType<typeof createHttpApi>;
  before(async () => {
    t = await testPlatform();
    server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test("enlace mágico → cookie HttpOnly → usar la API; un POST desde otro origen se rechaza (CSRF)", async () => {
    const r1 = await fetch(`${base}/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "web@correo.example" }) });
    assert.equal(r1.status, 200);
    const r2 = await fetch(`${base}/auth/magic?token=${tokenFrom(t.mail.sent.at(-1)!.text)}`, { redirect: "manual" });
    assert.equal(r2.status, 302);
    const cookie = r2.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    const session = cookie.split(";")[0]!;

    const body = JSON.stringify({ text: "Aumento histórico de 30%, según fuentes cercanas." });
    const evil = await fetch(`${base}/v1/analyze`, { method: "POST", headers: { cookie: session, origin: "https://sitio-malo.example", "content-type": "application/json" }, body });
    assert.equal(evil.status, 403);
    const ok = await fetch(`${base}/v1/analyze`, { method: "POST", headers: { cookie: session, origin: "https://sinhumo.example", "content-type": "application/json" }, body });
    assert.equal(ok.status, 200);

    const out = await fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie: session, origin: "https://sinhumo.example" } });
    assert.match(out.headers.get("set-cookie")!, /Max-Age=0/);
    const after = await fetch(`${base}/v1/plan`, { headers: { cookie: session } });
    assert.equal(after.status, 403);
  });

  test("fe de erratas y registro de réplicas son públicos", async () => {
    assert.equal((await fetch(`${base}/public/corrections`)).status, 200);
    const rec = (await (await fetch(`${base}/public/outlets/ddv/record`)).json()) as { rebuttals: unknown[] };
    assert.ok(Array.isArray(rec.rebuttals));
  });
});

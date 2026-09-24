/** Respuestas en foros/páginas con moderación, impacto y calificaciones. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AccessDeniedError, ValidationError } from "../src/domain/errors";
import { testPlatform, userWithPlan, type Handler } from "./helpers/platform";

const content = {
  kind: "result" as const,
  title: "Dato en disputa: el aumento es de 30%, no de 18%",
  summary: "La resolución 45 del ente regulador fija un aumento de 30%.",
  sections: [],
  links: [{ label: "Resolución 45", url: "https://boletin.example/res-45" }],
};
const forum = { kind: "forum_thread" as const, destination: "discourse:foro.example", ref: "123", inReplyTo: "1" };

/** Simula un foro Discourse y un blog WordPress. */
const fakeSites: Handler = (method, url) => {
  if (method === "POST" && url === "https://foro.example/posts.json") return { status: 200, text: JSON.stringify({ id: 999, topic_id: 123, post_number: 7, topic_slug: "tarifas" }) };
  if (url === "https://foro.example/posts/999.json") return { status: 200, text: JSON.stringify({ reads: 340, reply_count: 4, actions_summary: [{ id: 2, count: 21 }] }) };
  if (url === "https://foro.example/posts/by_number/123/1.json") return { status: 200, text: JSON.stringify({ version: 2, updated_at: "2026-09-25T10:00:00Z" }) };
  if (method === "POST" && url === "https://blog.example/wp-json/wp/v2/comments") return { status: 201, text: JSON.stringify({ id: 55, link: "https://blog.example/nota#comment-55" }) };
  if (url.startsWith("https://blog.example/wp-json/wp/v2/comments/55")) return { status: 200, text: JSON.stringify({ status: "spam" }) };
  if (url === "https://blog.example/wp-json/wp/v2/posts/42") return { status: 200, text: JSON.stringify({ modified_gmt: "2026-09-20T00:00:00" }) };
  return { status: 404 };
};

describe("Respuestas públicas", () => {
  test("reglas: hace falta el plan, el permiso y citar fuentes", async () => {
    const t = await testPlatform({ http: fakeSites });
    const free = await userWithPlan(t, "gratis", ["analyst"]);
    await assert.rejects(t.p.replies.request({ actorId: free.id, target: forum, content }), (e: AccessDeniedError) => e.code === "feature_not_in_plan");
    const reader = await userWithPlan(t, "profesional", ["reader"]);
    await assert.rejects(t.p.replies.request({ actorId: reader.id, target: forum, content }), (e: AccessDeniedError) => e.code === "no_permission");
    const analyst = await userWithPlan(t, "profesional", ["analyst"]);
    await assert.rejects(t.p.replies.request({ actorId: analyst.id, target: forum, content: { ...content, links: [] } }), ValidationError);
  });

  test("un analista propone → queda en revisión → un moderador aprueba → se publica con links de seguimiento e identificación de bot", async () => {
    const t = await testPlatform({ http: fakeSites });
    const admin = await userWithPlan(t, "gratis");
    const org = await t.p.users.createOrganization.execute({ ownerId: admin.id, name: "Chequeado Sur" });
    const analyst = await userWithPlan(t, "gratis", ["analyst"]);
    analyst.organizationId = org.id;
    await t.store.repos.users.save(analyst);

    const draft = await t.p.replies.request({ actorId: analyst.id, target: forum, content, topic: "tarifas de gas" });
    assert.equal(draft.status, "pending_review");
    assert.ok(t.p.events.history.some((e) => e.type === "reply.pending_review"));
    assert.equal(t.http.requests.filter((r) => r.method === "POST").length, 0, "no se publica nada sin aprobación");

    const published = await t.p.replies.review({ moderatorId: admin.id, draftId: draft.id, approve: true });
    assert.equal(published.status, "published");
    assert.equal(published.publishedUrl, "https://foro.example/t/tarifas/123/7");
    const post = t.http.requests.find((r) => r.method === "POST")!;
    const raw = (post.body as { raw: string }).raw;
    assert.match(raw, /https:\/\/sinhumo\.example\/r\/[\w-]+/, "los links pasan por el seguimiento propio");
    assert.match(raw, /Respuesta automática/);

    // Clic en el link de seguimiento: redirige al destino real y cuenta.
    const code = raw.match(/\/r\/([\w-]+)/)![1]!;
    assert.equal(await t.p.trackedLinks.resolve(code), "https://boletin.example/res-45");
  });

  test("límite de frecuencia por hilo: no se responde dos veces seguidas en el mismo tema", async () => {
    const t = await testPlatform({ http: fakeSites });
    const mod = await userWithPlan(t, "profesional", ["moderator"]);
    assert.equal((await t.p.replies.request({ actorId: mod.id, target: forum, content })).status, "published");
    const second = await t.p.replies.request({ actorId: mod.id, target: forum, content });
    assert.equal(second.status, "failed");
    assert.match(second.error ?? "", /rate_limited/);
  });
});

describe("Impacto", () => {
  test("mide vistas, reacciones, clics, correcciones del original y eliminaciones; reporta por destino y por tema", async () => {
    const t = await testPlatform({ http: fakeSites });
    const mod = await userWithPlan(t, "profesional", ["moderator"]);
    const inForum = await t.p.replies.request({ actorId: mod.id, target: forum, content, topic: "tarifas de gas" });
    const inBlog = await t.p.replies.request({ actorId: mod.id, target: { kind: "web_page", destination: "wordpress:blog.example", ref: "42" }, content, topic: "tarifas de gas" });
    assert.equal(inBlog.status, "published");

    const code = (await t.store.repos.trackedLinks.findByReply(inForum.id))[0]!.code;
    await t.p.trackedLinks.resolve(code);
    await t.p.trackedLinks.resolve(code);

    t.clock.advance(3 * 86_400_000);
    await t.p.impact.collect.execute({ lookbackDays: 30 });
    const r = await t.p.impact.report.execute({ from: new Date("2026-09-01"), to: t.clock.now() });

    assert.equal(r.totals.published, 2);
    assert.equal(r.totals.views, 340);
    assert.equal(r.totals.reactionsPositive, 21);
    assert.equal(r.totals.clicks, 2);
    assert.equal(r.totals.originalsCorrected, 1, "el post original del foro se editó después de nuestra respuesta");
    assert.equal(r.totals.repliesRemoved, 1, "el blog marcó nuestro comentario como spam");
    assert.equal(r.correctionRate, 0.5);
    assert.equal(r.removalRate, 0.5);
    assert.deepEqual(r.byDestination.map((d) => d.destination).sort(), ["discourse:foro.example", "wordpress:blog.example"]);
    assert.equal(r.byTopic[0]!.topic, "tarifas de gas");
  });
});

describe("Calificaciones y reseñas", () => {
  test("una por usuario (se edita), no se califica lo propio, moderación y resumen por origen incluyendo otras plataformas", async () => {
    const appStore: Handler = (_m, url) =>
      url.includes("itunes.apple.com")
        ? { status: 200, text: JSON.stringify({ feed: { entry: [
            { id: { label: "a1" }, author: { name: { label: "Juan" } }, "im:rating": { label: "5" }, title: { label: "Excelente" }, content: { label: "Me sirve mucho" }, updated: { label: "2026-09-01T00:00:00Z" } },
            { id: { label: "a2" }, author: { name: { label: "Sol" } }, "im:rating": { label: "2" }, content: { label: "Lento" }, updated: { label: "2026-09-02T00:00:00Z" } },
          ] } }) }
        : fakeSites("GET", url);
    const t = await testPlatform({ http: appStore });
    const u = await userWithPlan(t, "gratis");
    const platform = { type: "platform" as const, id: "sin-humo" };

    await t.p.reviews.submit({ userId: u.id, target: platform, rating: 3 });
    await t.p.reviews.submit({ userId: u.id, target: platform, rating: 4, text: "Muy útil" }); // edita, no duplica
    const insult = await t.p.reviews.submit({ userId: (await userWithPlan(t, "gratis")).id, target: platform, rating: 1, text: "Son unos idiotas" });
    assert.equal(insult.status, "rejected");

    await t.p.reviews.importExternal({ platform: "appstore", config: { appId: "123", country: "ar" }, target: platform });
    const s = await t.p.reviews.summary(platform);
    assert.equal(s.count, 3);
    assert.equal(s.bySource.interna!.average, 4);
    assert.deepEqual(s.bySource.appstore, { count: 2, average: 3.5 });

    const mod = await userWithPlan(t, "profesional", ["moderator"]);
    const draft = await t.p.replies.request({ actorId: mod.id, target: forum, content });
    await assert.rejects(t.p.reviews.submit({ userId: mod.id, target: { type: "reply", id: draft.id }, rating: 5 }), /pediste vos/);
  });
});

/**
 * Demo de la PLATAFORMA como una historia: WhatsApp, planes, organización,
 * moderación, respuesta en un foro, impacto, reseñas, MCP y cumplimiento.
 * Todo ficticio y sin conexión (canales y sitios simulados).
 *
 *   npm run demo:platform                      (base en memoria)
 *   DEMO_STORE=sqlite npm run demo:platform    (SQLite)
 */
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { seedCore } from "./composition/container";
import { buildPlatform, seedPlatform } from "./composition/platform";
import { demoSeed } from "./demo/seedData";
import { FakePaymentGateway } from "./infrastructure/billing/Payments";
import { buildMcpServer } from "./infrastructure/integrations/McpServer";
import { RecordingEmailTransport } from "./infrastructure/mail/MailAdapters";
import { RecordingSender } from "./infrastructure/messaging/ChannelAdapters";
import { createMemoryStore, createSqliteStore } from "./infrastructure/persistence/stores";
import { StubHttpClient } from "./infrastructure/system/EventsAndHttp";
import { ManualClock, SequentialIdGenerator, SilentLogger } from "./infrastructure/system/System";

const h = (s: string) => console.log(`\n━━ ${s} ${"━".repeat(Math.max(0, 66 - s.length))}`);
const say = (who: string, text: string) => console.log(`${who.padEnd(10)}│ ${text.split("\n").join(`\n${" ".repeat(10)}│ `)}`);

async function main() {
  const store = process.env.DEMO_STORE === "sqlite" ? createSqliteStore(":memory:") : createMemoryStore();
  await store.migrate();
  await seedCore(store, demoSeed);
  await seedPlatform(store);
  const clock = new ManualClock(new Date("2026-09-23T15:00:00Z"));
  const whatsapp = new RecordingSender("whatsapp");
  const mail = new RecordingEmailTransport();
  const http = new StubHttpClient((method, url) => {
    if (method === "POST" && url.endsWith("/posts.json")) return { status: 200, text: JSON.stringify({ id: 901, topic_id: 77, post_number: 5, topic_slug: "tarifas-gas" }) };
    if (url.endsWith("/posts/901.json")) return { status: 200, text: JSON.stringify({ reads: 412, reply_count: 6, actions_summary: [{ id: 2, count: 35 }] }) };
    if (url.endsWith("/posts/by_number/77/1.json")) return { status: 200, text: JSON.stringify({ version: 2, updated_at: "2026-09-24T12:00:00Z" }) };
    if (url.includes("itunes.apple.com")) return { status: 200, text: JSON.stringify({ feed: { entry: [{ id: { label: "r1" }, author: { name: { label: "Caro" } }, "im:rating": { label: "5" }, content: { label: "Por fin algo que separa datos de opiniones" }, updated: { label: "2026-09-10T00:00:00Z" } }] } }) };
    return { status: 404 };
  });
  const p = buildPlatform({
    store,
    core: { ai: { provider: "rules" }, fetcher: "memory", seed: demoSeed, clock, logger: new SilentLogger(), ids: new SequentialIdGenerator() },
    publicBaseUrl: "https://sinhumo.example",
    vaultMasterKey: "clave-maestra-de-la-demo-123",
    http,
    senders: [whatsapp],
    mail: { transport: mail, from: "Sin Humo <analizar@sinhumo.example>", trustedAuthServIds: ["mx.sinhumo.example"] },
    forums: { discourse: [{ host: "foro.example", baseUrl: "https://foro.example", apiKey: "k", apiUsername: "sinhumo" }] },
    payments: new FakePaymentGateway(),
    wait: async (ms) => clock.advance(ms),
  });
  const lastWa = () => whatsapp.outbox.at(-1)!.text;
  const ana = "+5492991234567";

  h(`1. Una cadena por WhatsApp (base de datos: ${store.engine})`);
  const chain = "URGENTE!!! Según fuentes cercanas al gobierno habrá un colapso histórico: el gas sube 300% mañana. Reenviá a todos.";
  say("Ana", `[reenviado muchas veces] ${chain}`);
  const { user } = await p.inbound.execute({ channel: "whatsapp", from: ana, text: chain, externalId: "wamid.1", receivedAt: clock.now(), displayName: "Ana", forwarded: true, forwardedManyTimes: true });
  say("Sin Humo", lastWa());

  h("2. Plan gratuito: lo que no incluye, con sugerencia de upgrade");
  say("Ana", "/credibilidad Diario del Valle | tarifas de gas");
  await p.inbound.execute({ channel: "whatsapp", from: ana, text: "/credibilidad Diario del Valle | tarifas de gas", externalId: "wamid.2", receivedAt: clock.now() });
  say("Sin Humo", lastWa());

  h("3. Upgrade a Personal: pago pendiente → confirmado por el proveedor");
  const { subscription, checkoutUrl } = await p.users.changePlan.execute({ actorId: user.id, planId: "personal" });
  console.log(`Checkout: ${checkoutUrl} · estado: ${subscription.status} · plan vigente: ${(await p.access.planOf(user)).plan.name}`);
  await p.users.confirmPayment.execute({ subscriptionId: subscription.id });
  console.log(`Pago confirmado · plan vigente: ${(await p.access.planOf(user)).plan.name}`);

  h("4. Organización con roles: analista propone, moderador aprueba, se publica en un foro");
  const org = await p.users.createOrganization.execute({ ownerId: user.id, name: "Verificadores del Valle" });
  const leo = await p.users.register.execute({ name: "Leo", channel: { type: "whatsapp", address: "+5492997654321", verified: true } });
  leo.organizationId = org.id;
  await store.repos.users.save(leo);
  await p.users.roles.assign({ actorId: user.id, targetId: leo.id, roleId: "analyst" });
  try {
    await p.users.roles.assign({ actorId: user.id, targetId: leo.id, roleId: "platform_admin" });
  } catch (e) {
    console.log(`Regla de roles: ${(e as Error).message}`);
  }
  const draft = await p.replies.request({
    actorId: leo.id,
    target: { kind: "forum_thread", destination: "discourse:foro.example", ref: "77", inReplyTo: "1" },
    content: { kind: "result", title: "El aumento aprobado es de 30%, no de 300%", summary: "La resolución 45 del ente regulador fija 30% desde abril.", sections: [], links: [{ label: "Resolución 45", url: "https://boletin.example/res-45" }] },
    topic: "tarifas de gas",
  });
  console.log(`Leo (analista) propone respuesta → ${draft.status}`);
  const published = await p.replies.review({ moderatorId: user.id, draftId: draft.id, approve: true });
  console.log(`Ana (admin) aprueba → ${published.status}: ${published.publishedUrl}`);
  const posted = http.requests.find((r) => r.method === "POST")!.body as { raw: string };
  say("Foro", posted.raw);

  h("5. Impacto a los 3 días");
  const code = (await store.repos.trackedLinks.findByReply(published.id))[0]!.code;
  for (let i = 0; i < 18; i++) await p.trackedLinks.resolve(code);
  clock.advance(3 * 86_400_000);
  await p.impact.collect.execute({ lookbackDays: 30 });
  const rep = await p.impact.report.execute({ from: new Date("2026-09-01"), to: clock.now() });
  console.log(`Vistas ${rep.totals.views} · Me gusta ${rep.totals.reactionsPositive} · Clics a la fuente ${rep.totals.clicks} · Originales corregidos ${rep.totals.originalsCorrected}/${rep.totals.published} · Respuestas eliminadas ${rep.totals.repliesRemoved}`);

  h("6. Reseñas: propias + App Store, con su origen");
  await p.reviews.submit({ userId: leo.id, target: { type: "platform", id: "sin-humo" }, rating: 4, text: "Muy útil para chequear cadenas" });
  await p.reviews.importExternal({ platform: "appstore", config: { appId: "1", country: "ar" }, target: { type: "platform", id: "sin-humo" } });
  const s = await p.reviews.summary({ type: "platform", id: "sin-humo" });
  console.log(`Promedio ${s.average} (${s.count} reseñas) · por origen: ${Object.entries(s.bySource).map(([k, v]) => `${k} ${v.average} (${v.count})`).join(", ")}`);

  h("7. Un agente de IA por MCP (con clave de API del plan Equipo)");
  // La ingesta periódica guarda notas y afirmaciones: es el historial del medidor de credibilidad.
  await p.core.ingestArticles.execute({ topic: "tarifas de gas", period: { from: new Date("2026-01-01"), to: new Date("2026-08-31") } });
  await p.users.changePlan.execute({ actorId: user.id, planId: "equipo" }).then((r) => p.users.confirmPayment.execute({ subscriptionId: r.subscription.id }));
  const { plaintext } = await p.integrations.apiKeys.create({ actorId: user.id, name: "agente", scopes: ["content:analyze", "credibility:view"] });
  const [c, sv] = InMemoryTransport.createLinkedPair();
  await buildMcpServer({ gateway: p.gateway, access: p.access, composer: p.composer, replies: p.replies, reviews: p.reviews, outlets: store.repos.outlets }, await p.integrations.apiKeys.authenticate(plaintext)).connect(sv);
  const client = new Client({ name: "agente-demo", version: "1.0.0" });
  await client.connect(c);
  console.log(`Herramientas: ${(await client.listTools()).tools.map((t) => t.name).join(", ")}`);
  const res = (await client.callTool({ name: "credibilidad_medio", arguments: { medio: "Diario del Valle", tema: "tarifas de gas", desde: "2026-01-01", hasta: "2026-08-31" } })) as { content: { text: string }[] };
  say("Agente", res.content[0]!.text.split("\n").slice(0, 3).join("\n"));
  await client.close();

  h("8. Cumplimiento: el proveedor advierte (403) y el destino se pausa solo");
  whatsapp.nextResults = [{ ok: false, httpStatus: 403, error: "account restricted" }];
  clock.advance(10_000);
  await p.inbound.execute({ channel: "whatsapp", from: ana, text: "/plan", externalId: "wamid.3", receivedAt: clock.now() });
  const health = await store.repos.destinationHealth.get("whatsapp");
  console.log(`Estado de WhatsApp: ${health?.state} — ${health?.reason}`);
  await store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

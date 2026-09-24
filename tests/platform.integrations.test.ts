/** Integraciones: MCP (en memoria y por HTTP), API para bots, webhooks firmados, RSS. */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { httpApiDeps } from "../src/composition/platform";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { buildMcpServer } from "../src/infrastructure/integrations/McpServer";
import { signWebhook } from "../src/infrastructure/integrations/WebhookDispatcher";
import { parseFeed } from "../src/infrastructure/content/RssSource";
import { testPlatform, userWithPlan, type Handler } from "./helpers/platform";

const FEED = `<?xml version="1.0"?><rss><channel>
<item><title>Nuevo aumento</title><link>https://diariodelvalle.example/nota-1</link><pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Es un aumento <b>histórico</b> de 12% según la resolución 50.</p>]]></description></item>
<item><title>Vieja</title><link>https://diariodelvalle.example/nota-0</link><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate><description>Nota vieja</description></item>
</channel></rss>`;

const hooks: Handler = (method, url) => {
  if (url === "https://feeds.example/rss.xml") return { status: 200, text: FEED };
  if (method === "POST" && url === "https://hooks.example/sinhumo") return { status: 200 };
  return { status: 404 };
};

function mcpDeps(t: Awaited<ReturnType<typeof testPlatform>>) {
  return { gateway: t.p.gateway, access: t.p.access, composer: t.p.composer, replies: t.p.replies, reviews: t.p.reviews, outlets: t.store.repos.outlets };
}

describe("MCP", () => {
  test("un agente lista herramientas y las usa con los permisos, el plan y la cuota de su clave", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "profesional");
    const { plaintext } = await t.p.integrations.apiKeys.create({ actorId: u.id, name: "agente", scopes: ["content:analyze", "sources:compare"] });
    const caller = await t.p.integrations.apiKeys.authenticate(plaintext);

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(mcpDeps(t), caller).connect(serverSide);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientSide);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((x) => x.name).sort(), ["analizar_contenido", "calificar", "comparar_fuentes", "credibilidad_medio", "mi_plan", "proponer_respuesta"]);

    const ok = (await client.callTool({ name: "analizar_contenido", arguments: { texto: "Es un logro histórico sin precedentes: la inflación bajó a 2,1% en agosto." } })) as { content: { text: string }[]; isError?: boolean };
    assert.ok(!ok.isError);
    assert.match(ok.content[0]!.text, /Índice de humo/);
    assert.ok(JSON.parse(ok.content[1]!.text).smokeIndex > 0);

    // La clave no tiene "credibility:view": el agente recibe el error, no datos.
    const denied = (await client.callTool({ name: "credibilidad_medio", arguments: { medio: "ddv", tema: "tarifas de gas", desde: "2026-01-01", hasta: "2026-08-31" } })) as { content: { text: string }[]; isError?: boolean };
    assert.equal(denied.isError, true);
    assert.match(denied.content[0]!.text, /permiso/);
    await client.close();
  });
});

describe("API HTTP", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let base: string;
  let key: string;
  let server: ReturnType<typeof createHttpApi>;
  const secrets = { whatsappVerifyToken: "verif", whatsappAppSecret: "app-secret", telegramSecretToken: "tg-secret", paymentsSecret: "pay-secret" };

  before(async () => {
    t = await testPlatform({ http: hooks });
    const u = await userWithPlan(t, "profesional", ["moderator"]);
    key = (await t.p.integrations.apiKeys.create({ actorId: u.id, name: "bot", scopes: ["content:analyze", "sources:compare", "credibility:view", "replies:moderate"] })).plaintext;
    server = createHttpApi(httpApiDeps(t.p, { secrets }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

  test("bots: con clave válida analiza; sin clave 403; errores de dominio como códigos HTTP", async () => {
    const ok = await post("/v1/analyze", { text: "Aumento histórico de 30%, según fuentes cercanas." }, { authorization: `Bearer ${key}` });
    assert.equal(ok.status, 200);
    assert.ok(((await ok.json()) as { smokeIndex: number }).smokeIndex > 0);
    assert.equal((await post("/v1/analyze", { text: "x" })).status, 403);
    assert.equal((await post("/v1/analyze", {}, { authorization: `Bearer ${key}` })).status, 400);
    assert.equal((await post("/v1/analyze", "{roto", { authorization: `Bearer ${key}` })).status, 400);
  });

  test("MCP por HTTP (Streamable HTTP) con la misma clave", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } });
    const client = new Client({ name: "agente-http", version: "1.0.0" });
    await client.connect(transport);
    const r = (await client.callTool({ name: "comparar_fuentes", arguments: { tema: "tarifas de gas", desde: "2026-03-01", hasta: "2026-03-31" } })) as { content: { text: string }[]; isError?: boolean };
    assert.ok(!r.isError, r.content[0]?.text);
    assert.match(r.content[0]!.text, /Comparación: tarifas de gas/);
    await client.close();
  });

  test("webhook de WhatsApp: verificación, firma obligatoria y respuesta al usuario", async () => {
    const verify = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=42`);
    assert.equal(await verify.text(), "42");

    const payload = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Leo" } }], messages: [{ from: "5491177777777", id: "wamid.A", timestamp: String(Math.floor(t.clock.now().getTime() / 1000)), type: "text", text: { body: "/ayuda" } }] } }] }] });
    assert.equal((await post("/webhooks/whatsapp", payload, { "x-hub-signature-256": "sha256=falsa" })).status, 401);
    const sig = `sha256=${createHmac("sha256", secrets.whatsappAppSecret).update(payload).digest("hex")}`;
    assert.equal((await post("/webhooks/whatsapp", payload, { "x-hub-signature-256": sig })).status, 200);
    // Se procesa después de responder 200: esperar a que salga la respuesta (con tope).
    for (let i = 0; i < 100 && !t.whatsapp.outbox.length; i++) await new Promise((r) => setTimeout(r, 50));
    assert.match(t.whatsapp.outbox.at(-1)!.text, /cómo usarlo/);
  });

  test("links de seguimiento: /r/:código redirige y cuenta", async () => {
    const draft = await t.p.replies.request({
      actorId: (await t.p.integrations.apiKeys.authenticate(key)).userId,
      target: { kind: "chat", destination: "whatsapp", ref: "+5491177777777" },
      content: { kind: "result", title: "Fuente", sections: [], links: [{ label: "Resolución", url: "https://boletin.example/r45" }] },
    });
    const code = (await t.store.repos.trackedLinks.findByReply(draft.id))[0]!.code;
    const res = await fetch(`${base}/r/${code}`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "https://boletin.example/r45");
  });
});

describe("Webhooks salientes y fuentes conectadas", () => {
  test("los eventos llegan firmados a los sistemas suscriptos", async () => {
    const t = await testPlatform({ http: hooks });
    const u = await userWithPlan(t, "profesional");
    const { signingSecret } = await t.p.integrations.webhooks.register({ actorId: u.id, url: "https://hooks.example/sinhumo", events: ["analysis.completed"] });
    await assert.rejects(t.p.integrations.webhooks.register({ actorId: u.id, url: "http://inseguro.example", events: ["analysis.completed"] }), /https/);

    await t.p.gateway.analyzeContent({ userId: u.id, channel: "web" }, {
      id: "c1", sourceType: "message", origin: {}, text: "Sube 10%.", urls: [], publishedAt: t.clock.now(), receivedAt: t.clock.now(), attachments: [], metadata: {},
    });
    const call = t.http.requests.find((r) => r.url === "https://hooks.example/sinhumo")!;
    assert.equal(call.headers["x-sinhumo-event"], "analysis.completed");
    const expected = `sha256=${signWebhook(signingSecret, call.headers["x-sinhumo-timestamp"]!, call.body as string)}`;
    assert.equal(call.headers["x-sinhumo-signature"], expected);
  });

  test("RSS: conectar (se prueba antes de guardar), sincronizar sólo lo nuevo y analizarlo", async () => {
    assert.equal(parseFeed(FEED).length, 2);
    const t = await testPlatform({ http: hooks });
    const u = await userWithPlan(t, "personal");
    await assert.rejects(t.p.content.connect.execute({ actorId: u.id, type: "rss", name: "Roto", config: { url: "https://feeds.example/no-existe" } }));
    const conn = await t.p.content.connect.execute({ actorId: u.id, type: "rss", name: "Diario del Valle", config: { url: "https://feeds.example/rss.xml" }, });
    await t.store.repos.sourceConnections.save({ ...conn, cursor: "2025-01-01T00:00:00Z" });

    const [first] = await t.p.content.sync.execute();
    assert.equal(first!.analyzed, 1, "sólo la nota posterior al cursor");
    const [second] = await t.p.content.sync.execute();
    assert.equal(second!.analyzed, 0, "no reprocesa");
    const saved = await t.store.repos.contentAnalyses.findByUser(u.id, 10);
    assert.equal(saved[0]!.item.title, "Nuevo aumento");
    assert.ok(saved[0]!.signals.some((s) => s.id === "known_outlet"), "reconoce que el origen es un medio registrado");
  });

  test("el plan limita las fuentes conectadas; la contraseña queda cifrada", async () => {
    const t = await testPlatform({ http: hooks });
    const free = await userWithPlan(t, "gratis");
    await assert.rejects(t.p.content.connect.execute({ actorId: free.id, type: "rss", name: "x", config: { url: "https://feeds.example/rss.xml" } }), /no está en el plan/);
    const ref = await t.p.vault.put("contraseña-imap");
    const stored = await t.store.repos.secrets.get(ref);
    assert.ok(stored && !stored.ciphertext.includes("contraseña"));
    assert.equal(await t.p.vault.get(ref), "contraseña-imap");
  });
});

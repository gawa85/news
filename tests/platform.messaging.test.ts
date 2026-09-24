/** Mensajería (WhatsApp/Telegram), comandos, bajas y cumplimiento ("anti bloqueo" legítimo). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { WhatsAppWebhookParser } from "../src/infrastructure/messaging/ChannelAdapters";
import { TelegramRenderer, WhatsAppRenderer } from "../src/infrastructure/messaging/Renderers";
import { SpanishCommandParser } from "../src/infrastructure/messaging/SpanishCommandParser";
import { BOT_DISCLOSURE } from "../src/infrastructure/compliance/CompliantDecorators";
import { testPlatform, userWithPlan, wa } from "./helpers/platform";

describe("Mensajes entrantes", () => {
  test("quien escribe por primera vez queda registrado (plan gratis, canal verificado) y recibe respuesta citando su mensaje", async () => {
    const t = await testPlatform();
    const msg = wa("+5491111111111", "URGENTE: según fuentes cercanas habrá un colapso histórico, el gas sube 300% mañana. Reenvialo!", t.clock.now(), { forwardedManyTimes: true, forwarded: true });
    const { user, response } = await t.p.inbound.execute(msg);

    assert.equal(user.channels[0]!.verified, true);
    assert.equal((await t.p.access.planOf(user)).plan.id, "gratis");
    assert.match(response.title, /Índice de humo/);
    assert.ok(response.sections.some((s) => s.lines.some((l) => /Reenviado muchas veces/.test(l))));
    const sent = t.whatsapp.outbox[0]!;
    assert.equal(sent.replyTo?.externalId, msg.externalId);
    assert.ok(sent.text.includes(BOT_DISCLOSURE), "WhatsApp exige identificarse como respuesta automática");
  });

  test("comandos: /excluir guarda una regla, /reglas la lista, /plan muestra el consumo", async () => {
    const t = await testPlatform();
    const from = "+5491122222222";
    await t.p.inbound.execute(wa(from, "/excluir opinionesya.example", t.clock.now()));
    const rules = await t.p.inbound.execute(wa(from, "/reglas", t.clock.now()));
    assert.match(JSON.stringify(rules.response), /opinionesya\.example/);
    const plan = await t.p.inbound.execute(wa(from, "/plan", t.clock.now()));
    assert.match(plan.response.title, /Gratis/);
  });

  test("un pedido fuera del plan responde con la sugerencia de upgrade (no con un error técnico)", async () => {
    const t = await testPlatform();
    const r = await t.p.inbound.execute(wa("+5491133333333", "/credibilidad Diario del Valle | tarifas de gas", t.clock.now()));
    assert.equal(r.response.kind, "denied");
    assert.match(r.response.footer ?? "", /Personal/);
  });

  test("BAJA: no se le mandan más avisos, pero se le sigue respondiendo si pregunta", async () => {
    const t = await testPlatform();
    const from = "+5491144444444";
    const { user } = await t.p.inbound.execute(wa(from, "BAJA", t.clock.now()));
    const notif = await t.p.notifications.notifyUser(user, t.p.composer.info("Aviso"), ["whatsapp"]);
    assert.equal(notif.ok, false);
    assert.match(notif.error ?? "", /opted_out/);
    const reply = await t.p.inbound.execute(wa(from, "/ayuda", t.clock.now()));
    assert.equal(reply.delivery.ok, true);
  });
});

describe("Cumplimiento y reputación de envío", () => {
  test("WhatsApp: fuera de la ventana de 24 h sólo se permiten plantillas", async () => {
    const t = await testPlatform();
    const from = "+5491155555555";
    const { user } = await t.p.inbound.execute(wa(from, "hola", t.clock.now()));
    t.clock.advance(25 * 3600_000);
    const free = await t.p.notifications.notifyUser(user, t.p.composer.info("Alerta"), ["whatsapp"]);
    assert.match(free.error ?? "", /outside_window/);
    const tpl = await t.p.channels.sender("whatsapp").send({ channel: "whatsapp", to: from, text: "", purpose: "notification", template: { name: "alerta_tema", language: "es_AR", params: ["tarifas"] } });
    assert.equal(tpl.ok, true);
  });

  test("429 del proveedor → el destino se enfría solo; 403 → se pausa hasta revisión humana", async () => {
    const t = await testPlatform();
    const from = "+5491166666666";
    await t.p.inbound.execute(wa(from, "hola", t.clock.now()));
    const sender = t.p.channels.sender("whatsapp");
    const msg = { channel: "whatsapp" as const, to: from, text: "x", purpose: "reply" as const };

    t.whatsapp.nextResults = [{ ok: false, httpStatus: 429, error: "rate limit" }];
    t.clock.advance(5_000);
    await sender.send(msg);
    assert.equal((await t.store.repos.destinationHealth.get("whatsapp"))?.state, "cooling_down");
    assert.match((await sender.send(msg)).error ?? "", /rate_limited/);

    t.clock.advance(10 * 60_000); // pasó el enfriamiento
    t.whatsapp.nextResults = [{ ok: false, httpStatus: 403, error: "account restricted" }];
    await sender.send(msg);
    assert.equal((await t.store.repos.destinationHealth.get("whatsapp"))?.state, "paused");
    assert.match((await sender.send(msg)).error ?? "", /destination_paused/);

    await t.p.guard.resume("whatsapp");
    t.clock.advance(5_000);
    assert.equal((await sender.send(msg)).ok, true);
  });

  test("límite por destinatario: no se le escribe dos veces seguidas a la misma persona", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "personal");
    await t.p.users.linkChannel.start({ userId: u.id, channel: "email", address: "ana@correo.example" });
    const again = await t.p.channels.sender("email").send({ channel: "email", to: "ana@correo.example", text: "x", purpose: "reply" });
    assert.match(again.error ?? "", /rate_limited/);
  });
});

describe("Adaptadores de canal", () => {
  test("parser del webhook de WhatsApp: texto, reenvío frecuente e ignorar estados", () => {
    const p = new WhatsAppWebhookParser();
    const msg = p.parse({ entry: [{ changes: [{ value: { contacts: [{ profile: { name: "Ana" } }], messages: [{ from: "5491100000000", id: "wamid.X", timestamp: "1790000000", type: "text", text: { body: "hola" }, context: { forwarded: true, frequently_forwarded: true } }] } }] }] });
    assert.equal(msg?.from, "+5491100000000");
    assert.equal(msg?.forwardedManyTimes, true);
    assert.equal(p.parse({ entry: [{ changes: [{ value: { statuses: [{ id: "x", status: "read" }] } }] }] }), null);
  });

  test("cada canal dibuja la misma respuesta a su manera y respeta su largo máximo", () => {
    const big = { kind: "result" as const, title: "T <b>", sections: [{ lines: Array.from({ length: 500 }, (_, i) => `línea ${i} con texto largo`) }], links: [] };
    const w = new WhatsAppRenderer().render(big, "+54");
    const tg = new TelegramRenderer().render(big, "1");
    assert.ok(w.text.length <= 4096 && w.text.startsWith("*T <b>*"));
    assert.ok(tg.text.length <= 4096 && tg.text.startsWith("<b>T &lt;b&gt;</b>"));
  });

  test("intérprete de comandos", () => {
    const p = new SpanishCommandParser();
    assert.deepEqual(p.parse("/comparar tarifas de gas 2026-03 https://a.example/x"), { type: "compare_sources", topic: "tarifas de gas", month: "2026-03", includeUrls: ["https://a.example/x"] });
    assert.deepEqual(p.parse("/credibilidad Diario | gas"), { type: "credibility", outlet: "Diario", topic: "gas" });
    assert.equal(p.parse("Mirá esto que me mandaron...").type, "analyze_content");
    assert.equal(p.parse("hola").type, "help");
  });
});

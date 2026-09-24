/** 4A: narrativas en circulación, campañas, "Otra mirada" y salas en tiempo real. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { AccessDeniedError, ValidationError } from "../src/domain/errors";
import type { RoomEvent } from "../src/domain/model";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

const CHAIN = "URGENTE!!! Según fuentes cercanas el gas sube 300% mañana. Llamá al 11 5555 1234 para más info. Reenviá a todos.";
const VARIANT = "Urgente: según fuentes cercanas el gas va a subir 300% desde mañana. Reenvialo a todos tus contactos.";

async function orgWithTeam(t: Awaited<ReturnType<typeof testPlatform>>) {
  const admin = await userWithPlan(t, "gratis");
  const org = await t.p.users.createOrganization.execute({ ownerId: admin.id, name: "Chequeo Sur" });
  const member = async (roleId: string) => {
    const u = await userWithPlan(t, "gratis");
    u.organizationId = org.id;
    await t.store.repos.users.save(u);
    await t.p.users.roles.assign({ actorId: admin.id, targetId: u.id, roleId });
    return (await t.store.repos.users.findById(u.id))!;
  };
  return { admin, org, member };
}

const verified = {
  kind: "result" as const,
  title: "El gas no sube 300%: el aumento aprobado es de 30%",
  summary: "La resolución 45 del ente regulador fija un aumento de 30% desde abril.",
  sections: [],
  links: [{ label: "Resolución 45", url: "https://boletin.example/res-45" }],
};

describe("Narrativas en circulación", () => {
  test("agrupa variantes de la misma cadena, oculta datos personales y no rastrea mensajes sin humo", async () => {
    const t = await testPlatform();
    await t.p.inbound.execute(wa("+5491100000001", CHAIN, t.clock.now()));
    t.clock.advance(10_000);
    await t.p.inbound.execute(wa("+5491100000002", VARIANT, t.clock.now()));
    await t.p.inbound.execute(wa("+5491100000003", "La reunión es a las 15 en la oficina de siempre.", t.clock.now()));
    const top = await t.p.participation.narratives.top(7);
    assert.equal(top.length, 1);
    assert.equal(top[0]!.occurrences, 2);
    assert.match(top[0]!.sample, /\[teléfono\]/);
    assert.ok(!top[0]!.sample.includes("5555"));
  });
});

describe("Campañas", () => {
  test("crear → aprobar (otra persona) → lanzar a quienes siguen el tema, con el emisor identificado; aliados medidos por separado", async () => {
    const t = await testPlatform();
    await t.p.inbound.execute(wa("+5491100000001", CHAIN, t.clock.now()));
    const narrative = (await t.p.participation.narratives.top(7))[0]!;
    const { admin, member } = await orgWithTeam(t);
    const analyst = await member("analyst");

    const follower = await userWithPlan(t, "personal");
    await t.p.users.createAlert.execute({ actorId: follower.id, topic: "tarifas de gas", trigger: "new_coverage", channel: "whatsapp" });

    const base = { actorId: analyst.id, claim: "El gas sube 300% mañana", channelIds: ["seguidores_del_tema"], narrativeId: narrative.id, topic: "tarifas de gas", political: false };
    await assert.rejects(t.p.participation.campaigns.create({ ...base, message: { ...verified, links: [] } }), /fuente/);
    const c = await t.p.participation.campaigns.create({ ...base, message: verified });
    assert.equal(c.status, "pending_review");
    assert.equal(c.sponsor, "Chequeo Sur");
    assert.match(c.pieces.find((p) => p.kind === "card")!.image!.data, /^<svg/);

    await assert.rejects(t.p.participation.campaigns.review({ actorId: analyst.id, campaignId: c.id, approve: true, note: "me la apruebo" }), AccessDeniedError);
    await t.p.participation.campaigns.review({ actorId: admin.id, campaignId: c.id, approve: true, note: "Fuentes correctas, tono adecuado." });
    await t.p.participation.campaigns.launch({ actorId: analyst.id, campaignId: c.id });

    const sent = t.whatsapp.outbox.at(-1)!;
    assert.equal(sent.to, follower.channels[0]!.address);
    assert.equal(sent.template?.params[0], "Chequeo Sur", "el emisor va en cada envío");
    assert.equal((await t.store.repos.narratives.findById(narrative.id))!.status, "countered");

    // Aliado: acepta y recibe un kit con links propios; su rendimiento se mide aparte.
    const ally = await member("reader");
    await t.p.participation.campaigns.inviteAllies({ actorId: analyst.id, campaignId: c.id, userIds: [ally.id] });
    t.clock.advance(60_000); // la persona responde un rato después
    await t.p.participation.campaigns.respondAlly({ userId: ally.id, campaignId: c.id, accept: true });
    const kitText = t.whatsapp.outbox.filter((m) => m.to === ally.channels[0]!.address).at(-1)!.text;
    const code = kitText.match(/\/r\/([\w-]+)/)![1]!;
    await t.p.trackedLinks.resolve(code);
    await t.p.trackedLinks.resolve(code);
    const report = await t.p.participation.campaigns.report(c.id);
    assert.equal(report.reach, 1);
    assert.equal(report.clicksByAlly[ally.id], 2);
  });

  test("contenido político no se difunde en veda electoral", async () => {
    const t = await testPlatform({ extra: { electoralBlackouts: [{ region: "AR", from: new Date("2026-09-20"), to: new Date("2026-09-30"), description: "veda de prueba" }] } });
    const { admin, member } = await orgWithTeam(t);
    const analyst = await member("analyst");
    const c = await t.p.participation.campaigns.create({ actorId: analyst.id, claim: "El candidato X prometió eliminar las jubilaciones", message: verified, channelIds: ["seguidores_del_tema"], topic: "elecciones", political: true });
    await t.p.participation.campaigns.review({ actorId: admin.id, campaignId: c.id, approve: true, note: "Revisado: es contenido político." });
    await assert.rejects(t.p.participation.campaigns.launch({ actorId: analyst.id, campaignId: c.id }), /Veda electoral/);
  });
});

describe("Otra mirada", () => {
  test("reglas por tipo, una por persona, votos únicos y orden por utilidad; cuestionar un hecho de la plataforma va a verificación", async () => {
    const t = await testPlatform();
    const target = { type: "topic" as const, id: "tarifas de gas" };
    const [a, b, c] = [await userWithPlan(t, "gratis"), await userWithPlan(t, "gratis"), await userWithPlan(t, "gratis")];
    const P = t.p.participation.perspectives;

    await assert.rejects(P.publish({ actorId: a.id, target, kind: "fact", text: "El aumento real es mayor al informado por el ente." }), /fuente/);
    await assert.rejects(P.publish({ actorId: a.id, target, kind: "interpretation", text: "Es un ajuste encubierto." }), /Argumentá/);
    const values = await P.publish({ actorId: a.id, target, kind: "values", text: "Prefiero que se priorice la tarifa social antes que el equilibrio fiscal." });
    assert.equal(values.status, "published");
    const edited = await P.publish({ actorId: a.id, target, kind: "values", text: "Creo que la prioridad tiene que ser la tarifa social para los hogares más pobres." });
    assert.equal(edited.id, values.id, "una por persona: se edita");

    const fact = await P.publish({ actorId: b.id, target, kind: "fact", text: "El análisis omite el aumento del cargo fijo, que también sube.", sources: [{ label: "Cuadro tarifario", url: "https://ente.example/cuadro" }], challengesPlatform: true });
    assert.ok((await t.p.verification.queue((await withRoles(t, c.id, ["fact_checker"])).id)).some((x) => x.question.includes("cargo fijo")));

    await assert.rejects(P.vote({ actorId: b.id, perspectiveId: fact.id, helpful: true }), /propia/);
    await P.vote({ actorId: a.id, perspectiveId: fact.id, helpful: true });
    await P.vote({ actorId: c.id, perspectiveId: fact.id, helpful: false });
    const switched = await P.vote({ actorId: c.id, perspectiveId: fact.id, helpful: true });
    assert.deepEqual([switched.helpful, switched.notHelpful], [2, 0]);

    const grouped = await P.forTarget(target);
    assert.equal(grouped.fact.length, 1);
    assert.equal(grouped.values.length, 1);
    const insult = await P.publish({ actorId: c.id, target, kind: "values", text: "Los que piensan distinto son unos idiotas." });
    assert.equal(insult.status, "rejected");
  });
});

describe("Salas del equipo en tiempo real", () => {
  test("sólo miembros con plan de equipo; mensajes en vivo, presencia, marca 'sin fuente', modo lento y borrado", async () => {
    const t = await testPlatform();
    const { admin, member } = await orgWithTeam(t);
    const ana = await member("analyst");
    const outsider = await userWithPlan(t, "profesional");
    await assert.rejects(t.p.participation.rooms.create({ actorId: outsider.id, name: "x" }), /equipos/);

    const room = await t.p.participation.rooms.create({ actorId: admin.id, name: "Tarifas de gas", slowModeSeconds: 5 });
    const seenByAna: RoomEvent[] = [];
    const seenByAdmin: RoomEvent[] = [];
    const j1 = await t.p.participation.rooms.join({ actorId: ana.id, roomId: room.id }, (e) => seenByAna.push(e));
    await t.p.participation.rooms.join({ actorId: admin.id, roomId: room.id }, (e) => seenByAdmin.push(e));
    assert.deepEqual((seenByAna.at(-1) as { userIds: string[] }).userIds.sort(), [ana.id, admin.id].sort());

    const m = await t.p.participation.rooms.post({ actorId: admin.id, roomId: room.id, text: "Ojo: el aumento real sería de 45% según un colega." });
    assert.deepEqual(m.flags, ["sin_fuente"]);
    assert.ok(seenByAna.some((e) => e.type === "message" && e.message.id === m.id));
    await assert.rejects(t.p.participation.rooms.post({ actorId: admin.id, roomId: room.id, text: "otra cosa" }), /Modo lento/);
    const withSource = await t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "Es 30%: https://boletin.example/res-45" });
    assert.deepEqual(withSource.flags, []);

    await assert.rejects(t.p.participation.rooms.remove({ actorId: ana.id, messageId: m.id }), AccessDeniedError);
    await t.p.participation.rooms.remove({ actorId: admin.id, messageId: m.id });
    assert.ok(seenByAna.some((e) => e.type === "deleted"));
    j1.leave();
    assert.deepEqual((seenByAdmin.at(-1) as { userIds: string[] }).userIds, [admin.id]);
    await assert.rejects(t.p.participation.rooms.post({ actorId: outsider.id, roomId: room.id, text: "hola" }), /equipos/);
    await assert.rejects(t.p.participation.rooms.create({ actorId: admin.id, name: "" }), ValidationError);
  });

  test("por HTTP: eventos en vivo por SSE", async () => {
    const t = await testPlatform();
    const { admin } = await orgWithTeam(t);
    await t.p.users.changePlan.execute({ actorId: admin.id, planId: "empresa" });
    const room = await t.p.participation.rooms.create({ actorId: admin.id, name: "Mesa" });
    const { plaintext } = await t.p.integrations.apiKeys.create({ actorId: admin.id, name: "web", scopes: ["rooms:use"] });
    const server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = { authorization: `Bearer ${plaintext}` };
    const ctrl = new AbortController();
    try {
      const stream = await fetch(`${base}/v1/rooms/${room.id}/events`, { headers: auth, signal: ctrl.signal });
      assert.equal(stream.headers.get("content-type"), "text/event-stream");
      const reader = stream.body!.getReader();
      const events: { type: string }[] = [];
      const readUntil = async (type: string) => {
        let buf = "";
        while (!events.some((e) => e.type === type)) {
          const { value } = await reader.read();
          buf += new TextDecoder().decode(value);
          for (const chunk of buf.split("\n\n").slice(0, -1)) if (chunk.startsWith("data: ")) events.push(JSON.parse(chunk.slice(6)));
          buf = buf.split("\n\n").at(-1)!;
        }
      };
      await readUntil("history");
      await fetch(`${base}/v1/rooms/${room.id}/messages`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ text: "¡Hola equipo!" }) });
      await readUntil("message");
      assert.ok(events.some((e) => e.type === "message"));
    } finally {
      ctrl.abort();
      await new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
    }
  });
});

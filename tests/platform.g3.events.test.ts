/** 3.11: salas en vivo para eventos (debates, elecciones) abiertas a todas las personas. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { AccessDeniedError, ValidationError } from "../src/domain/errors";
import type { EventInfo, PublicRoomMessage, RoomEvent } from "../src/domain/model";
import { aliasFromDigest, eventCodeFrom, eventStatus } from "../src/domain/rules/rooms";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

type T = Awaited<ReturnType<typeof testPlatform>>;
const H = 3_600_000;

/** Evento en vivo desde "ahora" por 3 horas, organizado por un verificador; participantes con cuentas de más de una hora. */
async function liveEvent(t: T, extra: { startsIn?: number } = {}) {
  const host = await withRoles(t, (await userWithPlan(t, "profesional")).id, ["fact_checker"]);
  const ana = await userWithPlan(t, "gratis", ["reader"], "+5491100000011");
  const beto = await userWithPlan(t, "gratis", ["reader"], "+5491100000012");
  t.clock.advance(2 * H); // cuentas con antigüedad
  const start = new Date(t.clock.now().getTime() + (extra.startsIn ?? 0));
  const room = await t.p.participation.events.create({ actorId: host.id, title: "Debate presidencial", startsAt: start, endsAt: new Date(start.getTime() + 3 * H), host: "Diario Norte" });
  return { host, ana, beto, room, code: room.event!.code };
}

describe("Eventos: reglas", () => {
  test("estado según el horario; códigos legibles; seudónimos", () => {
    const e = { startsAt: new Date("2026-10-01T21:00:00Z"), endsAt: new Date("2026-10-01T23:00:00Z"), muted: [], pinned: [] } as unknown as EventInfo;
    assert.equal(eventStatus(e, new Date("2026-10-01T20:59:00Z")), "scheduled");
    assert.equal(eventStatus(e, new Date("2026-10-01T21:00:00Z")), "live");
    assert.equal(eventStatus(e, new Date("2026-10-01T23:00:00Z")), "closed");
    assert.equal(eventStatus({ ...e, closedAt: new Date() }, new Date("2026-10-01T22:00:00Z")), "closed");
    assert.match(eventCodeFrom(123_456_789), /^[A-HJ-KM-NP-Z2-9]{6}$/);
    assert.equal(aliasFromDigest("4f2a99"), "Participante 4F2A");
  });
});

describe("Eventos: servicio", () => {
  test("sólo el equipo de eventos crea; horario válido y de hasta 24 h", async () => {
    const t = await testPlatform();
    const reader = await userWithPlan(t, "empresa");
    const now = t.clock.now();
    await assert.rejects(t.p.participation.events.create({ actorId: reader.id, title: "Debate", startsAt: now, endsAt: new Date(now.getTime() + H) }), AccessDeniedError);
    const host = await withRoles(t, reader.id, ["event_host"]);
    await assert.rejects(t.p.participation.events.create({ actorId: host.id, title: "Debate presidencial", startsAt: now, endsAt: now }), /terminar después/);
    await assert.rejects(t.p.participation.events.create({ actorId: host.id, title: "Debate presidencial", startsAt: now, endsAt: new Date(now.getTime() + 25 * H) }), /24 horas/);
    const r = await t.p.participation.events.create({ actorId: host.id, title: "Debate presidencial", startsAt: now, endsAt: new Date(now.getTime() + H) });
    assert.equal(r.kind, "event");
    assert.equal(r.organizationId, undefined);
  });

  test("cualquiera lee (sin cuenta); nadie ve quién es quién: seudónimos y cantidad de presentes", async () => {
    const t = await testPlatform();
    const { host, ana, beto, room } = await liveEvent(t);
    const anon: RoomEvent[] = [];
    const watch = await t.p.participation.rooms.join({ roomId: room.id }, (e) => anon.push(e));
    await t.p.participation.rooms.join({ actorId: beto.id, roomId: room.id }, () => undefined);
    assert.deepEqual(anon.at(-1), { type: "presence", count: 2 });

    const m1 = await t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "¿Alguien chequeó lo de la inflación?" });
    t.clock.advance(20_000);
    const m2 = await t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "Dijo 3% pero el INDEC informó 3,7%: https://indec.example/ipc" });
    assert.match(m1.alias!, /^Participante [0-9A-F]{4}$/);
    assert.equal(m1.alias, m2.alias, "estable en la sala");
    const seen = anon.filter((e): e is { type: "message"; message: PublicRoomMessage } => e.type === "message").map((e) => e.message);
    assert.equal(seen.length, 2);
    assert.ok(seen.every((m) => !("authorId" in m)), "el público nunca ve el id de quien escribió");
    assert.equal(watch.history.length, 0);

    // En otra sala, la misma persona tiene otro seudónimo.
    const other = await t.p.participation.events.create({ actorId: host.id, title: "Otro debate", startsAt: t.clock.now(), endsAt: new Date(t.clock.now().getTime() + H) });
    const m3 = await t.p.participation.rooms.post({ actorId: ana.id, roomId: other.id, text: "Hola" });
    assert.notEqual(m3.alias, m1.alias);
  });

  test("escribir: sólo en vivo, con cuenta con antigüedad, con modo lento y sin estar silenciado", async () => {
    const t = await testPlatform();
    const { host, ana, room } = await liveEvent(t, { startsIn: H });
    await assert.rejects(t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "Hola" }), /todavía no empezó/);
    t.clock.advance(H);

    const nueva = await userWithPlan(t, "gratis", ["reader"], "+5491100000099");
    await assert.rejects(t.p.participation.rooms.post({ actorId: nueva.id, roomId: room.id, text: "Hola" }), /después de 60 minutos/);

    const m = await t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "Primer comentario" });
    await assert.rejects(t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "Otro" }), /Modo lento/);

    await assert.rejects(t.p.participation.events.mute({ actorId: ana.id, messageId: m.id, minutes: 30 }), AccessDeniedError);
    const { until } = await t.p.participation.events.mute({ actorId: host.id, messageId: m.id, minutes: 30, removeMessage: true });
    assert.equal(until.getTime(), t.clock.now().getTime() + 30 * 60_000);
    t.clock.advance(60_000);
    await assert.rejects(t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "Sigo" }), /Te silenciaron/);
    assert.equal((await t.store.repos.rooms.findMessage(m.id))!.deleted, true);
    t.clock.advance(30 * 60_000);
    await t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "Ya puedo" });

    await t.p.participation.events.close({ actorId: host.id, roomId: room.id });
    t.clock.advance(60_000);
    await assert.rejects(t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "Tarde" }), /terminó/);
  });

  test("chequeos: se fijan, los firma el equipo y llegan por chat a quien se suscribió", async () => {
    const t = await testPlatform();
    const { host, ana, room, code } = await liveEvent(t);
    const sub = await t.p.inbound.execute(wa("+5491100000011", `/evento ${code.toLowerCase()}`, t.clock.now()));
    assert.match(sub.response.title, /Listo: te mando los chequeos de «Debate presidencial»/);
    const list = await t.p.inbound.execute(wa("+5491100000011", "/eventos", t.clock.now()));
    assert.match(list.response.sections[0]!.heading!, /🔴 En vivo · Debate presidencial/);

    await assert.rejects(t.p.participation.events.factCheck({ actorId: ana.id, roomId: room.id, text: "x" }), AccessDeniedError);
    t.clock.advance(60_000);
    const before = t.whatsapp.outbox.length;
    const fc = await t.p.participation.events.factCheck({ actorId: host.id, roomId: room.id, text: "FALSO: la inflación de agosto fue 3,7%, no 2%. Fuente: INDEC." });
    assert.deepEqual(fc.flags, ["verificacion"]);
    assert.equal(fc.alias, "Equipo del evento");
    const pub = await t.p.participation.events.get(code);
    assert.equal(pub.pinned[0]!.id, fc.id);
    assert.equal(pub.status, "live");

    // El aviso sale por la cola.
    for (let i = 0; i < 5 && (await t.p.jobs.worker().runOnce()).ran > 0; i++);
    const got = t.whatsapp.outbox.slice(before).filter((m) => m.to === "+5491100000011");
    assert.equal(got.length, 1);
    assert.match(got[0]!.text, /Chequeo en vivo · Debate presidencial[\s\S]*inflación de agosto fue 3,7%/);

    t.clock.advance(60_000);
    await t.p.inbound.execute(wa("+5491100000011", `/evento no ${code}`, t.clock.now()));
    assert.deepEqual(await t.store.repos.eventSubscriptions.findSubscribers(room.id), []);
  });

  test("tope contra el abuso y apagado de emergencia", async () => {
    const t = await testPlatform({ extra: { abuse: { rules: [{ action: "room_message", per: "user", limit: 2, windowSeconds: 3_600, onExceed: "deny" }] } } });
    const { ana, room } = await liveEvent(t);
    for (let i = 0; i < 2; i++) {
      await t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: `mensaje ${i}` });
      t.clock.advance(20_000);
    }
    await assert.rejects(t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "otro" }), /Demasiados/);

    const a = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    await t.p.flags.update({ actorId: a.id, key: "event_rooms", enabled: false });
    await assert.rejects(t.p.participation.events.create({ actorId: a.id, title: "Otro debate", startsAt: t.clock.now(), endsAt: new Date(t.clock.now().getTime() + H) }), ValidationError);
  });
});

describe("Eventos: HTTP", () => {
  test("lista y transmisión en vivo sin cuenta; crear con clave del equipo", async () => {
    const t = await testPlatform();
    const { host, ana, room, code } = await liveEvent(t);
    const key = (await t.p.integrations.apiKeys.create({ actorId: host.id, name: "equipo", scopes: ["content:analyze"] })).plaintext;
    const server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ctrl = new AbortController();
    try {
      const list = (await (await fetch(`${base}/public/events`)).json()) as { code: string; status: string }[];
      assert.deepEqual(list.map((e) => [e.code, e.status]), [[code, "live"]]);
      assert.equal((await fetch(`${base}/public/events/NOEXISTE`)).status, 404);

      const res = await fetch(`${base}/public/events/${code}/stream`, { signal: ctrl.signal });
      assert.equal(res.headers.get("content-type"), "text/event-stream");
      const reader = res.body!.getReader();
      let text = "";
      const until = async (re: RegExp) => {
        while (!re.test(text)) text += new TextDecoder().decode((await reader.read()).value);
      };
      await until(/"type":"history"/);
      await t.p.participation.rooms.post({ actorId: ana.id, roomId: room.id, text: "Comentario en vivo" });
      await until(/Comentario en vivo/);
      assert.doesNotMatch(text, new RegExp(ana.id), "el público no ve ids");

      const created = await fetch(`${base}/v1/events`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ title: "Cadena nacional", startsAt: t.clock.now().toISOString(), endsAt: new Date(t.clock.now().getTime() + H).toISOString() }),
      });
      assert.equal(created.status, 201);
    } finally {
      ctrl.abort();
      server.close();
    }
  });
});

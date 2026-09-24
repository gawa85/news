/** 4E: copias de seguridad y recuperación, ambientes y legal (aceptación versionada y riesgo de difamación). */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { createDecipheriv, scryptSync } from "node:crypto";
import { httpApiDeps } from "../src/composition/platform";
import { profileFor, validateEnvironment } from "../src/composition/environment";
import { LegalService } from "../src/application/legal/Legal";
import { BackupService, retentionPlan, DEFAULT_RETENTION } from "../src/application/ops/Backups";
import { LEGAL_DOCUMENTS } from "../src/config/legal";
import { ValidationError } from "../src/domain/errors";
import { assessDefamationRisk } from "../src/domain/rules/defamation";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { FileSystemBackupSink, MemoryBackupSink } from "../src/infrastructure/ops/BackupSinks";
import { createMemoryStore, createSqliteStore } from "../src/infrastructure/persistence/stores";
import { SilentLogger } from "../src/infrastructure/system/System";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

type T = Awaited<ReturnType<typeof testPlatform>>;
const PASS = "una-frase-de-cifrado-muy-larga-2026";
const PHONE = "+5491188887777";
const CHAIN = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario.";

async function withActivity(t: T) {
  await t.p.inbound.execute(wa(PHONE, CHAIN, t.clock.now(), { displayName: "Marta Gómez" }));
  const u = (await t.store.repos.users.findByChannel("whatsapp", PHONE))!;
  await t.p.config.preferences.update({ actorId: u.id, values: { followedTopics: ["gas"] } });
  return u;
}

const backups = (t: T, sink = new MemoryBackupSink(), pass = PASS) =>
  new BackupService(t.store, sink, pass, () => createMemoryStore(), t.clock, new SilentLogger(), "test");

function decrypt(data: Buffer, pass: string): string {
  const d = createDecipheriv("aes-256-gcm", scryptSync(pass, data.subarray(5, 21), 32), data.subarray(21, 33));
  d.setAuthTag(data.subarray(33, 49));
  return gunzipSync(Buffer.concat([d.update(data.subarray(49)), d.final()])).toString("utf8");
}

describe("Copias de seguridad", () => {
  test("copia cifrada con suma de verificación; se restaura en otra base (incluso otro motor)", async () => {
    const t = await testPlatform();
    const u = await withActivity(t);
    const sink = new MemoryBackupSink();
    const svc = backups(t, sink);
    const m = await svc.create("manual");
    assert.ok(m.collections.users >= 1);
    assert.equal(m.collections.sessions, undefined, "las sesiones no se respaldan");
    const raw = sink.files.get(m.key)!;
    assert.equal(raw.subarray(0, 5).toString(), "SHBK1");
    assert.ok(!raw.includes(Buffer.from(PHONE)), "cifrada: el teléfono no se lee en el archivo");
    assert.ok(!sink.files.get(`${m.key}.json`)!.includes(Buffer.from(PHONE)), "el manifiesto no tiene datos personales");

    // Restaurar en SQLite (otro motor) y usar los datos con los repositorios normales.
    const target = createSqliteStore(":memory:");
    await target.migrate();
    const restored = await svc.restore(m.key, target);
    assert.equal(restored.users, m.collections.users);
    const back = await target.repos.users.findByChannel("whatsapp", PHONE);
    assert.equal(back?.id, u.id);
    assert.equal((await target.repos.preferences.findUser(u.id))?.values.followedTopics?.[0], "tarifas-gas");
    await assert.rejects(svc.restore(m.key, target), /no está vacía/, "nunca pisa una base con datos");
    await target.close();
  });

  test("frase incorrecta, archivo alterado y verificación periódica", async () => {
    const t = await testPlatform();
    await withActivity(t);
    const sink = new MemoryBackupSink();
    const m = await backups(t, sink).create("daily");
    await assert.rejects(backups(t, sink, "otra-frase-equivocada-123").restore(m.key, createMemoryStore()), /No se pudo descifrar/);
    const v = await backups(t, sink).verify(m.key);
    assert.equal(v.verification?.ok, true, v.verification?.detail);
    assert.ok(v.verifiedAt);
    const bad = Buffer.from(sink.files.get(m.key)!);
    bad[bad.length - 1] ^= 0xff;
    sink.files.set(m.key, bad);
    await assert.rejects(backups(t, sink).restore(m.key, createMemoryStore()), /dañada/);
    const v2 = await backups(t, sink).verify(m.key);
    assert.equal(v2.verification?.ok, false);
    assert.throws(() => new BackupService(t.store, sink, "corta", () => createMemoryStore(), t.clock, new SilentLogger(), "test"));
  });

  test("copia anonimizada para staging: mismas relaciones, sin datos personales ni secretos", async () => {
    const t = await testPlatform();
    const u = await withActivity(t);
    const admin = await withRoles(t, (await userWithPlan(t, "profesional")).id, ["platform_admin"]);
    await t.p.integrations.apiKeys.create({ actorId: admin.id, name: "bot", scopes: ["smoke:analyze"] });
    const sink = new MemoryBackupSink();
    const svc = backups(t, sink);
    const m = await svc.create("staging_copy", { scrubSecret: "clave-de-anonimizado" });
    assert.equal(m.scrubbed, true);
    assert.ok(m.key.startsWith("staging/"));
    const content = decrypt(sink.files.get(m.key)!, PASS);
    assert.ok(!content.includes(PHONE.slice(1)), "sin el teléfono");
    assert.ok(!content.includes("Marta"), "sin el nombre");
    assert.ok(!content.includes("lo dijo un funcionario"), "sin el texto de los mensajes (tampoco en las narrativas)");
    assert.equal(m.collections.api_keys, 0, "sin claves de API");
    assert.equal(m.collections.secrets, 0);

    const staging = createMemoryStore();
    await staging.migrate();
    await svc.restore(m.key, staging);
    const users = await staging.raw.read("users");
    assert.equal(users.length, await t.store.raw.count("users"));
    const masked = (await staging.repos.users.findById(u.id))!;
    const addr = masked.channels[0]!.address;
    assert.match(addr, /^\+99\d{10}$/);
    assert.equal((await staging.repos.users.findByChannel("whatsapp", addr))?.id, u.id, "la relación usuario↔canal sigue funcionando");
    assert.equal((await staging.repos.outlets.findAll()).length, (await t.store.repos.outlets.findAll()).length, "el catálogo público se copia igual");
    assert.ok(masked.createdAt instanceof Date, "las fechas se conservan");
  });

  test("retención abuelo-padre-hijo y copia diaria que limpia lo viejo", async () => {
    const now = new Date("2026-09-24T06:00:00Z");
    const items = Array.from({ length: 120 }, (_, i) => ({ key: `k${i}`, kind: "daily" as const, createdAt: new Date(now.getTime() - i * 86_400_000).toISOString() }));
    items.push({ key: "manual-vieja", kind: "daily" as never, createdAt: "2020-01-01T00:00:00Z" });
    const plan = retentionPlan([...items, { key: "pre", kind: "pre_migration" as never, createdAt: "2026-09-01T00:00:00Z" }], now, DEFAULT_RETENTION);
    for (let i = 0; i < 7; i++) assert.ok(plan.keep.includes(`k${i}`), "las últimas 7 diarias");
    assert.ok(plan.keep.includes("pre"), "las previas a migraciones se guardan un año");
    assert.ok(plan.keep.length < 7 + 4 + 12 + 2);
    assert.ok(plan.remove.includes("k100"));

    const t = await testPlatform();
    const sink = new MemoryBackupSink();
    const svc = backups(t, sink);
    for (let i = 0; i < 10; i++) {
      await svc.runDaily();
      t.clock.advance(86_400_000);
    }
    const kept = await svc.list();
    assert.ok(kept.length >= 7 && kept.length < 10, `se podaron las viejas (${kept.length})`);
    assert.equal(kept[0]!.createdAt, new Date(t.clock.now().getTime() - 86_400_000).toISOString(), "la más reciente siempre queda");
  });

  test("destino en disco: escritura atómica, listado y sin salir de la carpeta", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sinhumo-bk-"));
    try {
      const sink = new FileSystemBackupSink(dir);
      await sink.put("backups/2026/09/24/a.shbk", Buffer.from("hola"));
      assert.equal((await sink.get("backups/2026/09/24/a.shbk"))?.toString(), "hola");
      assert.deepEqual(await sink.list("backups/"), ["backups/2026/09/24/a.shbk"]);
      await assert.rejects(sink.put("../fuera.shbk", Buffer.from("x")), /inválida|fuera/);
      await sink.delete("backups/2026/09/24/a.shbk");
      assert.equal(await sink.get("backups/2026/09/24/a.shbk"), undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Ambientes", () => {
  test("producción no arranca con configuración peligrosa", () => {
    const prod = profileFor("production");
    const errors = validateEnvironment(prod, {
      DATABASE_URL: "sqlite.db", VAULT_MASTER_KEY: "changeme", PUBLIC_BASE_URL: "http://sinhumo.example", METRICS_TOKEN: "x".repeat(30),
      STATS_PSEUDONYM_SECRET: "y".repeat(30), LOAD_DEMO_DATA: "1",
    });
    const all = errors.join("\n");
    assert.match(all, /BACKUP_PASSPHRASE/);
    assert.match(all, /VAULT_MASTER_KEY es débil/);
    assert.match(all, /https/);
    assert.match(all, /PostgreSQL/);
    assert.match(all, /datos de demo/);
    assert.match(all, /copias/);
    const ok = validateEnvironment(prod, {
      DATABASE_URL: "postgres://db/sinhumo", VAULT_MASTER_KEY: "k".repeat(40), PUBLIC_BASE_URL: "https://sinhumo.example", METRICS_TOKEN: "m".repeat(30),
      BACKUP_PASSPHRASE: "p".repeat(30), STATS_PSEUDONYM_SECRET: "s".repeat(30), BACKUP_S3_BUCKET: "copias",
    });
    assert.deepEqual(ok, []);
    assert.deepEqual(validateEnvironment(profileFor(undefined), {}), [], "desarrollo sin configuración");
    assert.match(validateEnvironment(profileFor("staging"), { DATABASE_URL: "postgres://prod-db.internal/sh", PRODUCTION_DATABASE_HOST: "prod-db.internal" }).join(), /PRODUCCIÓN/);
    assert.throws(() => profileFor("qa"), /desconocido/);
  });

  test("fuera de producción sólo se escribe a la lista del equipo, con prefijo", async () => {
    const team = "+5491100001111";
    const t = await testPlatform({ extra: { environment: { name: "staging", sandbox: { allowlist: [team], prefix: "[PRUEBA]" } } } });
    const before = t.whatsapp.outbox.length;
    const r = await t.p.inbound.execute(wa("+5491199998888", CHAIN, t.clock.now()));
    assert.equal(r.delivery.ok, true, "para el sistema, 'se envió'");
    assert.equal(t.whatsapp.outbox.length, before, "pero a una persona real no le llegó nada");
    await t.p.inbound.execute(wa(team, CHAIN, t.clock.now()));
    assert.match(t.whatsapp.outbox.at(-1)!.text, /^\[PRUEBA\] /);

    const server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
    try {
      const h = (await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/health`)).json()) as { environment: string };
      assert.equal(h.environment, "staging");
    } finally {
      server.close();
    }
  });
});

describe("Legal", () => {
  test("el primer mensaje trae el aviso con términos y privacidad; se registra qué versión se aceptó", async () => {
    const t = await testPlatform();
    const from = "+5491122224444";
    const r1 = await t.p.inbound.execute(wa(from, "hola", t.clock.now()));
    assert.match(r1.response.footer!, /Términos y condiciones \(https:\/\/sinhumo\.example\/legal\/terminos\) y Política de privacidad/);
    const u = r1.user;
    const consents = await t.store.repos.consents.findByUser(u.id);
    assert.deepEqual(consents.map((c) => [c.docId, c.version, c.method]).sort(), [["privacy", "2026-09-borrador", "chat_notice"], ["terms", "2026-09-borrador", "chat_notice"]]);
    t.clock.advance(60_000);
    const r2 = await t.p.inbound.execute(wa(from, "hola de nuevo", t.clock.now()));
    assert.doesNotMatch(r2.response.footer ?? "", /Términos/, "una sola vez por versión");

    // Nueva versión MATERIAL de los términos: se vuelve a pedir.
    const v2 = new LegalService(LEGAL_DOCUMENTS.map((d) => (d.id === "terms" ? { ...d, version: "2027-01" } : d)), t.store.repos.consents, t.clock, "https://sinhumo.example");
    assert.deepEqual((await v2.pendingFor(u.id)).map((d) => d.id), ["terms"]);
    await assert.rejects(v2.accept({ userId: u.id, docId: "terms", version: "2026-09-borrador", method: "click", channel: "web" }), ValidationError);
    await v2.accept({ userId: u.id, docId: "terms", version: "2027-01", method: "click", channel: "web" });
    assert.deepEqual(await v2.pendingFor(u.id), []);
  });

  test("riesgo de difamación: detecta imputaciones a medios identificables y sugiere cómo reescribir", () => {
    const names = ["El Diario del Valle", "Grupo Andino"];
    const high = assessDefamationRisk("El Diario del Valle miente y está pagado por el gobierno.", names);
    assert.equal(high.level, "high");
    assert.match(high.suggestions[0]!, /dato oficial/);
    assert.equal(assessDefamationRisk("El Diario del Valle publicó que el gas sube 50%; según la Resolución 45 es 30%.", names).level, "low");
    assert.equal(assessDefamationRisk("El Diario del Valle hace propaganda.", names).level, "medium");
    assert.equal(assessDefamationRisk("El Diario del Valle hace propaganda: según el informe, 8 de 10 notas no citan fuente.", names).level, "low");
    assert.equal(assessDefamationRisk("Alguien miente sobre el gas.", names).level, "low", "sin nadie identificable");
    assert.equal(assessDefamationRisk("GRUPO ANDINO es corrupto", names).level, "high");
  });

  test("lo riesgoso no se publica solo: otra mirada queda en revisión y la campaña avisa a quien revisa", async () => {
    const t = await testPlatform();
    const u = await userWithPlan(t, "equipo");
    const risky = await t.p.participation.perspectives.publish({
      actorId: u.id, target: { type: "topic", id: "tarifas de gas" }, kind: "values",
      text: "El Diario del Valle miente a sabiendas: es una opereta pagada por el gobierno provincial para tapar el aumento.",
    });
    assert.equal(risky.status, "pending_moderation");
    const other = await userWithPlan(t, "equipo");
    const fine = await t.p.participation.perspectives.publish({
      actorId: other.id, target: { type: "topic", id: "tarifas de gas" }, kind: "values",
      text: "Creo que la cobertura del aumento debería explicar mejor el impacto en jubilados y jubiladas de la provincia.",
    });
    assert.equal(fine.status, "published");

    const boss = await userWithPlan(t, "gratis");
    await t.p.users.createOrganization.execute({ ownerId: boss.id, name: "Chequeo" });
    const org = (await t.store.repos.users.findById(boss.id))!;
    const c = await t.p.participation.campaigns.create({
      actorId: org.id, claim: "El Diario del Valle dice que el gas sube 300%", channelIds: ["seguidores_del_tema"], topic: "tarifas de gas", political: false,
      message: { kind: "result", title: "El Diario del Valle miente: el gas no sube 300%", summary: "La Resolución 45 fija 30%.", sections: [], links: [{ label: "Res. 45", url: "https://boletin.example/45" }] },
    });
    assert.match(c.riskNotes?.[0] ?? "", /riesgo de difamación/);
  });
});

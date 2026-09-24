import { buildPlatform, seedPlatform, type PlatformConfig } from "../../src/composition/platform";
import { seedCore } from "../../src/composition/container";
import { demoSeed } from "../../src/demo/seedData";
import type { IDataStore } from "../../src/domain/ports";
import { FakeInvoiceIssuer, FakePaymentGateway } from "../../src/infrastructure/billing/Payments";
import { RecordingEmailTransport } from "../../src/infrastructure/mail/MailAdapters";
import { RecordingSender } from "../../src/infrastructure/messaging/ChannelAdapters";
import { createMemoryStore, createPostgresStore, createSqliteStore } from "../../src/infrastructure/persistence/stores";
import { PostgresClient } from "../../src/infrastructure/persistence/sql/PostgresClient";
import { randomUUID } from "node:crypto";

/**
 * Motor de base para los tests de plataforma: TEST_STORE=memory (defecto) | sqlite | postgres.
 * En PostgreSQL cada plataforma de prueba usa un esquema nuevo (aislamiento total).
 */
async function createTestStore(): Promise<IDataStore> {
  const engine = process.env.TEST_STORE ?? "memory";
  if (engine === "sqlite") return createSqliteStore(":memory:");
  if (engine === "postgres") {
    const url = process.env.TEST_DATABASE_URL!;
    const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const admin = new PostgresClient(url, 1);
    await admin.run(`CREATE SCHEMA ${schema}`);
    await admin.close();
    // Pool chico: cada test arma su plataforma y el servidor tiene un tope de conexiones.
    return createPostgresStore(`${url}?options=${encodeURIComponent(`-c search_path=${schema}`)}`, 3);
  }
  return createMemoryStore();
}
import { StubHttpClient } from "../../src/infrastructure/system/EventsAndHttp";
import { ManualClock, SilentLogger } from "../../src/infrastructure/system/System";
import { ScryptPasswordHasher } from "../../src/infrastructure/security/AuthAdapters";
import { FakeTextToSpeech, StaticDnsTxtResolver } from "../../src/infrastructure/inclusion/InclusionAdapters";

export type Handler = (method: string, url: string, body?: unknown) => { status: number; text?: string };

export async function testPlatform(opts: { store?: IDataStore; http?: Handler; now?: string; extra?: Partial<PlatformConfig> } = {}) {
  const store = opts.store ?? (await createTestStore());
  await store.migrate();
  await seedCore(store, demoSeed);
  await seedPlatform(store);
  const clock = new ManualClock(new Date(opts.now ?? "2026-09-23T15:00:00Z"));
  const whatsapp = new RecordingSender("whatsapp");
  const telegram = new RecordingSender("telegram");
  const mail = new RecordingEmailTransport();
  const http = new StubHttpClient(opts.http ?? (() => ({ status: 404 })));
  const payments = new FakePaymentGateway();
  const invoiceIssuer = new FakeInvoiceIssuer();
  const tts = new FakeTextToSpeech();
  const dns = new StaticDnsTxtResolver();
  const p = buildPlatform({
    store,
    core: { ai: { provider: "rules" }, fetcher: "memory", seed: demoSeed, clock, logger: new SilentLogger() },
    publicBaseUrl: "https://sinhumo.example",
    vaultMasterKey: "clave-maestra-de-prueba-123456",
    http,
    senders: [whatsapp, telegram],
    mail: { transport: mail, from: "Sin Humo <analizar@sinhumo.example>", trustedAuthServIds: ["mx.sinhumo.example"] },
    forums: {
      discourse: [{ host: "foro.example", baseUrl: "https://foro.example", apiKey: "k", apiUsername: "sinhumo" }],
      wordpress: [{ host: "blog.example", baseUrl: "https://blog.example", user: "u", appPassword: "p" }],
    },
    payments,
    wait: async (ms) => clock.advance(ms),
    oauth: { google: { clientId: "cliente-google", clientSecret: "secreto-google" } },
    passwordHasher: new ScryptPasswordHasher({ N: 1024, r: 8, p: 1 }), // liviano para tests
    invoicing: { issuer: invoiceIssuer, seller: { taxCondition: "responsable_inscripto", pointOfSale: 3, vatRate: 0.21 } },
    tts,
    dns,
    ...opts.extra,
  });
  return { p, store, clock, whatsapp, telegram, mail, http, payments, invoiceIssuer, tts, dns };
}

/** Mensaje entrante de WhatsApp ya normalizado. */
export function wa(from: string, text: string, at: Date, extra: Record<string, unknown> = {}) {
  return { channel: "whatsapp" as const, from, text, externalId: `wamid.${Math.random().toString(36).slice(2)}`, receivedAt: at, displayName: "Ana", ...extra };
}

/** Crea un usuario con un plan dado (atajo para tests). */
export async function userWithPlan(t: Awaited<ReturnType<typeof testPlatform>>, planId: string, roleIds = ["reader"], address = `+54911${Math.floor(Math.random() * 1e7)}`) {
  const u = await t.p.users.register.execute({ name: "Test", channel: { type: "whatsapp", address, verified: true } });
  u.roleIds = roleIds;
  await t.store.repos.users.save(u);
  if (planId !== "gratis") {
    const cur = await t.store.repos.subscriptions.findCurrent({ type: "user", id: u.id });
    if (cur) await t.store.repos.subscriptions.save({ ...cur, status: "replaced" });
    await t.store.repos.subscriptions.save({ id: `sub-${u.id}-${planId}`, subject: { type: "user", id: u.id }, planId, status: "active", currentPeriodEnd: new Date("2027-01-01"), createdAt: new Date(t.clock.now().getTime() + 1000) });
  }
  return u;
}

/** Da un rol de plataforma (atajo para tests: en producción lo hace un admin). */
export async function withRoles(t: Awaited<ReturnType<typeof testPlatform>>, userId: string, roleIds: string[]) {
  const u = (await t.store.repos.users.findById(userId))!;
  u.roleIds = [...new Set([...u.roleIds, ...roleIds])];
  await t.store.repos.users.save(u);
  return u;
}

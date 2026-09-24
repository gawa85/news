/**
 * TESTS DE CONTRATO DE LA BASE DE DATOS.
 * La MISMA batería corre contra cada motor. Si un motor nuevo pasa estos tests,
 * se puede enchufar sin tocar el resto del sistema.
 *
 * PostgreSQL corre sólo si está definida la variable TEST_DATABASE_URL.
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { ConflictError } from "../src/domain/errors";
import type { Article, Subscription, User } from "../src/domain/model";
import type { IDataStore } from "../src/domain/ports";
import { createMemoryStore, createPostgresStore, createSqliteStore } from "../src/infrastructure/persistence/stores";

const engines: [string, () => IDataStore][] = [
  ["memoria", createMemoryStore],
  ["sqlite", () => createSqliteStore(":memory:")],
];
if (process.env.TEST_DATABASE_URL) engines.push(["postgresql", () => createPostgresStore(process.env.TEST_DATABASE_URL!)]);

const d = (s: string) => new Date(s);
const user = (id: string, org?: string): User => ({
  id, name: `Usuario ${id}`, status: "active", roleIds: ["reader"], organizationId: org,
  channels: [{ channel: "whatsapp", address: "+5491100000000", verified: true, linkedAt: d("2026-01-01T00:00:00Z") }],
  createdAt: d("2026-01-01T00:00:00Z"),
});
const article = (id: string, outletId: string, date: string): Article => ({
  id, outletId, url: `https://x.example/${id}`, title: "t", body: "b", publishedAt: d(date), region: { country: "AR" }, topic: "gas",
});

for (const [engine, create] of engines) {
  describe(`Base de datos: ${engine}`, () => {
    let store: IDataStore;
    const prefix = `t${Date.now()}_`; // aísla corridas repetidas en PostgreSQL

    before(async () => {
      store = create();
      await store.migrate();
      await store.migrate(); // idempotente
    });
    after(() => store.close());

    test("guarda y recupera documentos preservando fechas y objetos anidados", async () => {
      await store.repos.users.save(user(`${prefix}u1`));
      const u = await store.repos.users.findById(`${prefix}u1`);
      assert.ok(u);
      assert.ok(u.createdAt instanceof Date);
      assert.equal(u.channels[0]!.linkedAt.toISOString(), "2026-01-01T00:00:00.000Z");
    });

    test("filtra por rango de fechas y ordena", async () => {
      await store.repos.articles.saveMany([
        article(`${prefix}a3`, `${prefix}o`, "2026-03-03T10:00:00Z"),
        article(`${prefix}a1`, `${prefix}o`, "2026-03-01T10:00:00Z"),
        article(`${prefix}a9`, `${prefix}o`, "2026-09-01T10:00:00Z"),
      ]);
      const found = await store.repos.articles.find({
        outletId: `${prefix}o`, topic: "gas", period: { from: d("2026-03-01T00:00:00Z"), to: d("2026-03-31T00:00:00Z") },
      });
      assert.deepEqual(found.map((a) => a.id), [`${prefix}a1`, `${prefix}a3`]);
    });

    test("una dirección de canal pertenece a un solo usuario (unicidad garantizada por la base)", async () => {
      await store.repos.users.claimChannel(`${prefix}u1`, "whatsapp", `+54911${prefix}`);
      await store.repos.users.claimChannel(`${prefix}u1`, "whatsapp", `+54911${prefix}`); // idempotente para el mismo usuario
      await assert.rejects(store.repos.users.claimChannel(`${prefix}u2`, "whatsapp", `+54911${prefix}`), ConflictError);
      const owner = await store.repos.users.findByChannel("whatsapp", `+54911${prefix}`);
      assert.equal(owner?.id, `${prefix}u1`);
    });

    test("reprocesar las afirmaciones de un artículo las reemplaza", async () => {
      const claim = (id: string) => ({ id, articleId: `${prefix}a1`, outletId: "o", text: id, kind: "fact" as const, attribution: "none" as const, numbers: [] });
      await store.repos.claims.saveMany([claim(`${prefix}c1`), claim(`${prefix}c2`)]);
      await store.repos.claims.saveMany([claim(`${prefix}c3`)]);
      const found = await store.repos.claims.findByArticleIds([`${prefix}a1`]);
      assert.deepEqual(found.map((c) => c.id), [`${prefix}c3`]);
    });

    test("cuenta uso por sujeto, métrica y fecha", async () => {
      const s = `${prefix}org`;
      for (const at of ["2026-09-01T10:00:00Z", "2026-09-20T10:00:00Z", "2026-09-21T10:00:00Z"]) {
        await store.repos.usage.record({ subjectId: s, metric: "comparisons", userId: "u", at: d(at) });
      }
      await store.repos.usage.record({ subjectId: s, metric: "analyses", userId: "u", at: d("2026-09-21T10:00:00Z") });
      assert.equal(await store.repos.usage.count(s, "comparisons", d("2026-09-15T00:00:00Z")), 2);
    });

    test("la suscripción vigente es la más reciente", async () => {
      const sub = (id: string, created: string): Subscription => ({
        id, subject: { type: "organization", id: `${prefix}org` }, planId: id, status: "active",
        currentPeriodEnd: d("2026-12-31T00:00:00Z"), createdAt: d(created),
      });
      await store.repos.subscriptions.save(sub(`${prefix}s-old`, "2026-01-01T00:00:00Z"));
      await store.repos.subscriptions.save(sub(`${prefix}s-new`, "2026-06-01T00:00:00Z"));
      const cur = await store.repos.subscriptions.findCurrent({ type: "organization", id: `${prefix}org` });
      assert.equal(cur?.id, `${prefix}s-new`);
    });

    test("una transacción que falla no deja nada guardado", async () => {
      await assert.rejects(
        store.transaction(async (repos) => {
          await repos.users.save(user(`${prefix}tx`));
          throw new Error("falla a mitad de camino");
        }),
      );
      assert.equal(await store.repos.users.findById(`${prefix}tx`), undefined);
    });

    test("una transacción exitosa guarda todo", async () => {
      await store.transaction(async (repos) => {
        await repos.users.save(user(`${prefix}ok`));
        await repos.users.claimChannel(`${prefix}ok`, "email", `${prefix}ok@x.example`);
      });
      assert.equal((await store.repos.users.findByChannel("email", `${prefix.toUpperCase()}OK@x.example`))?.id, `${prefix}ok`);
    });
  });
}

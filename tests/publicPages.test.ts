/** Lo público (sin cuenta): ficha de cada medio, fe de erratas, observatorio y datos abiertos. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { testPlatform } from "./helpers/platform";

describe("Páginas públicas", () => {
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

  test("ficha de un medio: dueños con su fuente y pauta oficial del último año, por quién paga", async () => {
    const r = await fetch(`${base}/public/outlets/ddv`);
    assert.equal(r.status, 200);
    const p = (await r.json()) as { outlet: { name: string }; owners: { name: string; businessSectors: string[]; source?: string }[]; advertising: { payer: string; amount: number; currency: string }[]; rebuttals: unknown[] };
    assert.equal(p.outlet.name, "El Diario del Valle");
    assert.deepEqual(p.owners.map((o) => [o.name, o.source]), [["Grupo Andino", "semilla"]]);
    assert.ok(p.owners[0]!.businessSectors.includes("energía"));
    assert.deepEqual(p.advertising.map((a) => [a.payer, a.currency]), [["Gobierno de la Provincia del Valle", "ARS"]]);
    assert.ok(p.advertising[0]!.amount > 0);
    assert.equal((await fetch(`${base}/public/outlets/no-existe`)).status, 404);
  });

  test("observatorio del mes, narrativas en circulación y lista de datos abiertos", async () => {
    const month = t.clock.now().toISOString().slice(0, 7);
    const obs = (await (await fetch(`${base}/public/observatory?month=${month}`)).json()) as { totals: { analyses: number }; methodology: string };
    assert.equal(typeof obs.totals.analyses, "number");
    assert.ok(obs.methodology.length > 20);
    assert.equal((await fetch(`${base}/public/narratives?days=7`)).status, 200);
    const ds = (await (await fetch(`${base}/public/datasets`)).json()) as { id: string; license: string }[];
    assert.ok(ds.length > 0 && ds.every((d) => d.license));
    const csv = await fetch(`${base}/public/datasets/${ds[0]!.id}.csv`);
    assert.equal(csv.headers.get("content-type"), "text/csv; charset=utf-8");
  });
});

/** Que haya datos no quiere decir que sean ciertos: cotejo entre medios, sin puntaje si nada está corroborado, y panorama de todos los medios. */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Article, Claim } from "../src/domain/model";
import { comparableFigures } from "../src/domain/rules/figures";
import { crossCheck } from "../src/infrastructure/credibility/CorroborationDimension";
import { WordClaimIndexer } from "../src/infrastructure/heuristics/WordClaimIndexer";
import { testPlatform, userWithPlan } from "./helpers/platform";
import { post, startWebApi } from "./helpers/webSession";

const at = new Date("2026-09-20T12:00:00Z");
const art = (outletId: string, id: string): Article => ({
  id: `corr-${outletId}-${id}`, outletId, url: `https://${outletId}.example/${id}`, title: id, body: "", publishedAt: at, region: { country: "AR" }, topic: "inflación",
});
const claim = (a: Article, text: string, numbers: number[]): Claim => ({
  id: `${a.id}-c`, articleId: a.id, outletId: a.outletId, text, kind: "fact", attribution: "none", numbers,
});
const period = { from: "2026-09-01T00:00:00Z", to: "2026-09-30T23:59:59Z" };

describe("Credibilidad: corroborar, no sólo tener datos", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let web: Awaited<ReturnType<typeof startWebApi>>;

  before(async () => {
    t = await testPlatform();
    web = await startWebApi(t);
    for (const o of ["cor-a", "cor-b", "cor-c"]) await t.store.repos.outlets.save({ id: o, name: o.toUpperCase(), url: `https://${o}.example`, kind: "digital", region: { country: "AR" } });
    const a1 = art("cor-a", "1"), b1 = art("cor-b", "1"), c1 = art("cor-c", "1");
    const a2 = art("cor-a", "2"), b2 = art("cor-b", "2");
    const a3 = art("cor-a", "3");
    await t.store.repos.articles.saveMany([a1, b1, c1, a2, b2, a3]);
    await t.store.repos.claims.saveMany([
      // La misma cifra en tres medios, con palabras distintas: se corrobora.
      claim(a1, "El INDEC informó que la inflación de agosto fue del 2,1 por ciento mensual", [2.1]),
      claim(b1, "Según el INDEC la inflación de agosto llegó al 2,1 por ciento", [2.1]),
      claim(c1, "La inflación de agosto fue 2,1 por ciento, informó el INDEC ayer", [2.1]),
      // Otro medio da otra cifra: no coincide.
      claim(a2, "El desempleo del segundo trimestre subió al 7,9 por ciento según el INDEC", [7.9]),
      claim(b2, "El desempleo del segundo trimestre bajó al 6,4 por ciento según el INDEC", [6.4]),
      // Sólo lo dice un medio.
      claim(a3, "Las ventas de autos usados crecieron 12 por ciento en septiembre", [12]),
    ]);
  });
  after(() => web.close());

  test("cotejo de un dato: misma cifra, cifra distinta, copia textual y sin cotejar", () => {
    const idx = (...c: Claim[]) => new WordClaimIndexer().index(c);
    const base: Claim = { id: "x", articleId: "x", outletId: "a", text: "La inflación de agosto fue del 2,1 por ciento según el INDEC", kind: "fact", attribution: "none", numbers: [2.1] };
    const other = (text: string, numbers: number[]): Claim => ({ ...base, id: text, outletId: "b", text, numbers });
    assert.equal(crossCheck(base, idx(other("Según el INDEC la inflación de agosto llegó al 2,1 por ciento", [2.1]))).result, "same");
    assert.equal(crossCheck(base, idx(other("Según el INDEC la inflación de agosto llegó al 3,5 por ciento", [3.5]))).result, "different");
    assert.equal(crossCheck(base, idx(other(base.text, [2.1]))).result, "copy", "el mismo cable copiado no corrobora");
    assert.equal(crossCheck(base, idx(other("River ganó el clásico por dos goles", [2]))).result, "alone");
    // Números de ley o fechas no son cifras comparables: hablan de lo mismo, pero no se dice que no coinciden.
    assert.equal(crossCheck({ ...base, text: "El decreto 70 derogó la Ley 26.737 de Tierras Rurales el lunes 9", numbers: [70, 26.737, 9] }, idx(other("El decreto 70 que derogó la Ley 26.737 de Tierras Rurales se publicó el martes 10", [70, 26.737, 10]))).result, "same");
    assert.equal(crossCheck({ ...base, text: "La visita del Papa a la Argentina empieza el lunes 9 en Buenos Aires", numbers: [9] }, idx(other("La visita del Papa a la Argentina empieza el domingo 8 en Buenos Aires", [8]))).result, "unclear");
    // Los años no son la cifra del dato: "en 2026" no hace coincidir dos cifras distintas.
    assert.equal(crossCheck({ ...base, numbers: [2.1, 2026] }, idx(other("Según el INDEC la inflación de agosto llegó al 3,5 por ciento en 2026", [3.5, 2026]))).result, "different");
  });

  test("ficha de un medio: el cotejo con otros medios se ve y explica las cifras distintas", async () => {
    const u = await userWithPlan(t, "profesional");
    const r = await t.p.gateway.evaluateCredibility({ userId: u.id, channel: "web" }, { outletId: "cor-a", topic: "inflación", period: { from: new Date(period.from), to: new Date(period.to) } });
    const d = r.dimensions.find((x) => x.dimensionId === "corroboration")!;
    assert.match(d.summary, /De 3 datos con cifras: 1 también los publica otro medio con la misma cifra, 1 otros medios los dan con cifras distintas, 0 otros medios hablan de lo mismo sin cifras comparables/);
    assert.equal(d.score, 0.5);
    assert.match(d.summary, /Se pudo cotejar el 67 % de sus datos/);
    assert.match(d.evidence[0]!.description, /Cifra distinta/);
    // Dos cotejos no alcanzan para dar un puntaje: sigue "sin corroborar".
    assert.equal(r.verification.status, "unverified");
    assert.equal(r.overall, null);
    // La pauta sin datos ya no cuenta como perfecta.
    assert.equal(r.dimensions.find((x) => x.dimensionId === "official_advertising")!.score, null);
  });

  test("con datos verificados por personas sí hay puntaje general", async () => {
    const u = await userWithPlan(t, "profesional");
    await t.store.repos.verdicts.save({ claimId: "corr-cor-a-1-c", status: "confirmed", checkedAt: at });
    const r = await t.p.gateway.evaluateCredibility({ userId: u.id, channel: "web" }, { outletId: "cor-a", topic: "inflación", period: { from: new Date(period.from), to: new Date(period.to) } });
    assert.equal(r.verification.status, "verified");
    assert.notEqual(r.overall, null);
  });

  test("panorama: todos los medios juntos y los datos más repetidos sin verificar", async () => {
    const u = await web.login("panorama@correo.example");
    const cur = await t.store.repos.subscriptions.findCurrent({ type: "user", id: u.userId });
    if (cur) await t.store.repos.subscriptions.save({ ...cur, status: "replaced" });
    await t.store.repos.subscriptions.save({ id: "sub-panorama", subject: { type: "user", id: u.userId }, planId: "profesional", status: "active", currentPeriodEnd: new Date("2027-06-01"), createdAt: new Date(t.clock.now().getTime() + 1000) });

    const res = await u("/v1/credibility/overview", post({ topic: "inflación", ...period }));
    assert.equal(res.status, 200);
    type Row = { outletId: string; articles: number; overall: number | null; verification: { status: string } };
    const o = (await res.json()) as { rows: Row[]; toVerify: { text: string; outlets: string[]; conflicting: boolean }[]; totals: { articles: number; factClaims: number; verifiedClaims: number } };
    assert.deepEqual(o.rows.map((r) => r.outletId).slice(0, 3), ["cor-a", "cor-b", "cor-c"], "los que más notas tienen primero");
    assert.equal(o.rows[0]!.verification.status, "verified");
    assert.equal(o.rows[2]!.verification.status, "unverified");
    assert.equal(o.totals.verifiedClaims, 1);
    // La inflación la dicen tres medios, pero una ya está verificada: igual queda en la lista por las otras dos.
    const inflation = o.toVerify.find((x) => /inflación/.test(x.text))!;
    assert.deepEqual(inflation.outlets.sort(), ["COR-B", "COR-C"]);
    const jobs = o.toVerify.find((x) => /desempleo/.test(x.text))!;
    assert.equal(jobs.conflicting, true, "cifras distintas");
    assert.ok(!o.toVerify.some((x) => /autos usados/.test(x.text)), "lo que dice uno solo no es 'repetido'");

    assert.equal((await u("/v1/credibility/overview", post({ from: period.to, to: period.from }))).status, 400);
  });

  test("desde el panorama: qué dijo cada medio, mandar a verificar (sin duplicar), resolver y que cuente", async () => {
    type Item = { text: string; topic: string; claims: { claimId: string; outletName: string; articleUrl: string }[]; task?: { id: string; status: string } };
    const overview = async (who: Awaited<ReturnType<typeof web.login>>) =>
      ((await (await who("/v1/credibility/overview", post({ topic: "inflación", ...period }))).json()) as { toVerify: Item[]; rows: { outletId: string; verification: { status: string } }[] });
    const checker = await web.login("verifica.panorama@correo.example", ["platform_admin"]);
    const cur = await t.store.repos.subscriptions.findCurrent({ type: "user", id: checker.userId });
    if (cur) await t.store.repos.subscriptions.save({ ...cur, status: "replaced" });
    await t.store.repos.subscriptions.save({ id: "sub-verifica", subject: { type: "user", id: checker.userId }, planId: "profesional", status: "active", currentPeriodEnd: new Date("2027-06-01"), createdAt: new Date(t.clock.now().getTime() + 1000) });

    const jobs = (await overview(checker)).toVerify.find((x) => /desempleo/.test(x.text))!;
    assert.equal(jobs.topic, "inflación");
    assert.deepEqual(jobs.claims.map((c) => c.outletName).sort(), ["COR-A", "COR-B"]);
    assert.ok(jobs.claims.every((c) => c.articleUrl.startsWith("https://")));
    assert.equal(jobs.task, undefined);

    // Quien no es del equipo de verificación no puede.
    const reader = await web.login("lector.panorama@correo.example");
    assert.equal((await reader("/v1/verification/tasks", post({ claimIds: jobs.claims.map((c) => c.claimId) }))).status, 403);

    const ids = jobs.claims.map((c) => c.claimId);
    const created = (await (await checker("/v1/verification/tasks", post({ claimIds: ids, take: true }))).json()) as { id: string; status: string; question: string; outletIds: string[] };
    assert.equal(created.status, "assigned");
    assert.match(created.question, /^¿Es cierto\? «/);
    const again = (await (await checker("/v1/verification/tasks", post({ claimIds: [ids[0]] }))).json()) as { id: string };
    assert.equal(again.id, created.id, "no se duplica: se usa la que ya está");
    assert.equal((await overview(checker)).toVerify.find((x) => /desempleo/.test(x.text))!.task?.status, "assigned");
    assert.equal((await checker("/v1/verification/tasks", post({ claimIds: ["no-existe"] }))).status, 404);
    assert.equal((await checker("/v1/verification/tasks", post({ claimIds: [] }))).status, 400);

    // Resolver: con evidencia y nota; cuenta para la credibilidad y sale de la lista.
    const tid = encodeURIComponent(created.id);
    await checker(`/v1/verification/tasks/${tid}/evidence`, post({ source: "INDEC", description: "EPH segundo trimestre: 7,9 %", url: "https://www.indec.gob.ar/eph" }));
    const done = await checker(`/v1/verification/tasks/${tid}/resolve`, post({ verdicts: { [ids.find((i) => i.includes("cor-a"))!]: "confirmed", [ids.find((i) => i.includes("cor-b"))!]: "refuted" }, note: "El INDEC informó 7,9 % para el segundo trimestre." }));
    assert.equal(done.status, 200, await done.text());
    const after = await overview(checker);
    assert.ok(!after.toVerify.some((x) => /desempleo/.test(x.text)), "ya verificado: sale de la lista");
    assert.equal(after.rows.find((r) => r.outletId === "cor-b")!.verification.status, "verified");
  });
});

describe("Cifras comparables", () => {
  test("porcentajes y montos (con miles y decimales argentinos); no fechas ni números de ley", () => {
    assert.deepEqual(comparableFigures("La inflación fue 2,1% y el desempleo 7,9 por ciento"), { percent: [2.1, 7.9], money: [] });
    assert.deepEqual(comparableFigures("Compras por u$s 3.000 millones y $ 41.000 millones de deuda"), { percent: [], money: [3e9, 41e9] });
    assert.deepEqual(comparableFigures("Una inversión de 500 millones de dólares"), { percent: [], money: [5e8] });
    assert.deepEqual(comparableFigures("La Ley 26.737 y el lunes 9 a las 18"), { percent: [], money: [] });
  });
});

/** 4B: datos reales (catálogo importable, feeds) y calidad medible (evaluación, versiones, "¿te sirvió?"). */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computeMetrics } from "../src/application/quality/Quality";
import { AccessDeniedError, ConflictError } from "../src/domain/errors";
import type { SmokeAnalysis } from "../src/domain/model";
import type { ISmokeDetector } from "../src/domain/ports";
import { CsvCatalogSource, KeywordTopicClassifier, matchOutlet, parseAmount, parseCsv, parseDate } from "../src/infrastructure/catalog/CatalogAdapters";
import { TOPICS } from "../src/config/topics";
import { SEED_EVALUATION_SET } from "../src/config/evaluationSet";
import { FEEDBACK_ASK } from "../src/application/messaging/ResponseComposer";
import { seedPlatform } from "../src/composition/platform";
import { testPlatform, userWithPlan, wa, withRoles, type Handler } from "./helpers/platform";

const OUTLETS_CSV = `id;nombre;url;tipo;pais;provincia;localidad;rss;alias
nortehoy;Norte Hoy;https://nortehoy.example;digital;AR;Salta;Salta;https://nortehoy.example/rss;Ediciones Boreales|NH
;Sin URL;;digital;AR;;;;
malo;Medio Malo;ftp://medio-malo;digital;AR;;;;`;

const OWNERSHIP_CSV = `medio,dueño,sectores,desde,hasta,fuente
Norte Hoy,Grupo Minero del Norte,minería|energía,01/02/2021,,Registro de Propiedad de Medios
Medio Fantasma,Nadie,,2020-01-01,,x`;

// Formato típico de los datasets públicos de pauta: razón social, montos con puntos y coma.
const ADS_CSV = `medio;pagador;jurisdiccion;monto;moneda;desde;hasta
"EDICIONES BOREALES S.R.L.";Gobierno de Salta;provincial;"48.000.000,00";ARS;01/01/2026;31/08/2026
Medio Fantasma;Gobierno de Salta;provincial;1.000,00;ARS;01/01/2026;31/01/2026
Norte Hoy;Municipio de Salta;municipal;-5;ARS;01/01/2026;31/01/2026`;

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Suben las tarifas de gas en Salta</title><link>https://nortehoy.example/economia/gas-salta</link><pubDate>Tue, 15 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>El ente regulador aprobó un aumento de 25% en las tarifas de gas, según la resolución 88. El aumento alcanza a 300 mil usuarios.</p>]]></description></item>
<item><title>Paritaria docente</title><link>https://nortehoy.example/educacion/paritaria</link><pubDate>Wed, 16 Sep 2026 10:00:00 GMT</pubDate><description>Los docentes cerraron la paritaria con un aumento de 12% en tres cuotas.</description></item>
</channel></rss>`;

const http: Handler = (_m, url) => (url === "https://nortehoy.example/rss" ? { status: 200, text: RSS } : { status: 404 });

const sources = [
  new CsvCatalogSource("medios", "Catálogo propio de medios", "outlets", { text: OUTLETS_CSV }),
  new CsvCatalogSource("propiedad", "Registro de propiedad", "ownership", { text: OWNERSHIP_CSV }),
  new CsvCatalogSource("pauta-salta", "Pauta oficial Salta (datos abiertos)", "advertising", { text: ADS_CSV }),
];

async function withCatalog() {
  const t = await testPlatform({ http, extra: { catalogSources: sources } });
  const admin = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
  return { t, admin };
}

describe("Catálogo real importable", () => {
  test("lectores tolerantes: CSV con ; y comillas, montos y fechas argentinas, nombres por alias", () => {
    const rows = parseCsv('a;b\n"x; y";"dijo ""hola"""\n');
    assert.deepEqual(rows, [{ a: "x; y", b: 'dijo "hola"' }]);
    assert.equal(parseAmount("48.000.000,50"), 48_000_000.5);
    assert.equal(parseAmount("1234567.89"), 1_234_567.89);
    assert.equal(parseDate("31/08/2026").toISOString().slice(0, 10), "2026-08-31");
    const outlets = [{ id: "nh", name: "Norte Hoy", url: "https://nortehoy.example", kind: "digital" as const, region: { country: "AR" }, aliases: ["Ediciones Boreales"] }];
    assert.equal(matchOutlet("EDICIONES BOREALES S.R.L.", outlets)?.id, "nh");
    assert.equal(matchOutlet("Diario Norte Hoy", outlets)?.id, "nh");
    assert.equal(matchOutlet("Otro", outlets), undefined);
  });

  test("importa medios, dueños y pauta; informa lo que no pudo asociar y rechaza datos inválidos", async () => {
    const { t, admin } = await withCatalog();

    const m = await t.p.catalog.import.execute({ actorId: admin.id, sourceId: "medios" });
    assert.equal(m.outlets, 1);
    assert.equal(m.feeds, 1);
    assert.equal(m.unmatched.length, 1, "la fila sin URL");
    assert.match(m.rejected[0]!, /malo: URL inválida/);
    assert.equal((await t.store.repos.outlets.findById("nortehoy"))?.aliases?.[0], "Ediciones Boreales");

    const o = await t.p.catalog.import.execute({ actorId: admin.id, sourceId: "propiedad" });
    assert.equal(o.ownership, 1);
    assert.deepEqual(o.unmatched, ["Medio Fantasma"]);
    const [record] = await t.store.repos.catalog.findOwnership("nortehoy");
    assert.equal(record?.source, "Registro de Propiedad de Medios", "cada dato guarda de dónde salió");

    const a = await t.p.catalog.import.execute({ actorId: admin.id, sourceId: "pauta-salta" });
    assert.equal(a.advertising, 1, "sólo la fila válida");
    assert.deepEqual(a.unmatched, ["Medio Fantasma"]);
    assert.equal(a.rejected.length, 1);
    assert.match(a.rejected[0]!, /monto inválido/);
    const spends = await t.store.repos.catalog.findAdvertising("nortehoy", { from: new Date("2026-01-01"), to: new Date("2026-12-31") });
    assert.equal(spends[0]?.amount, 48_000_000, "asociada por la razón social (alias)");

    const audit = await t.store.repos.audit.find({ action: "catalog.imported" });
    assert.ok(audit.length >= 3, "cada importación queda en la auditoría");
  });

  test("sólo quien puede editar el catálogo lo importa", async () => {
    const { t } = await withCatalog();
    const reader = await userWithPlan(t, "empresa");
    await assert.rejects(t.p.catalog.import.execute({ actorId: reader.id, sourceId: "medios" }), AccessDeniedError);
  });

  test("dueños y pauta de la semilla ahora viven en la base (el núcleo los lee de ahí)", async () => {
    const t = await testPlatform();
    const [own] = await t.store.repos.catalog.findOwnership("ddv");
    assert.equal(own?.ownerId, "grupo-andino");
    const r = await t.p.core.evaluateCredibility.evaluate({ outletId: "ddv", topic: "tarifas de gas", period: { from: new Date("2026-01-01"), to: new Date("2026-08-31") } });
    const ads = r.dimensions.find((d) => d.dimensionId === "official_advertising")!;
    assert.ok(ads.score! < 0.5, "la pauta provincial alta se sigue viendo");
  });
});

describe("Noticias reales desde los feeds", () => {
  test("ingiere, clasifica por tema, no duplica y alimenta comparación y credibilidad", async () => {
    const { t, admin } = await withCatalog();
    for (const s of ["medios", "propiedad", "pauta-salta"]) await t.p.catalog.import.execute({ actorId: admin.id, sourceId: s });

    const r1 = await t.p.catalog.ingestFeeds.execute();
    assert.deepEqual(r1, { feeds: 1, articles: 2, errors: 0 });
    const gas = await t.store.repos.articles.find({ topic: "tarifas de gas" });
    const mine = gas.filter((a) => a.outletId === "nortehoy");
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.region.province, "Salta", "la nota hereda la región del medio");
    assert.equal((await t.store.repos.articles.find({ topic: "empleo" })).length + (await t.store.repos.articles.find({ topic: "educación" })).length, 1);

    // Segunda pasada: nada nuevo. Y aunque se vuelva a leer todo, los ids estables evitan duplicados.
    assert.equal((await t.p.catalog.ingestFeeds.execute()).articles, 0);
    const [feed] = await t.store.repos.catalog.findActiveFeeds();
    await t.store.repos.catalog.saveFeed({ ...feed!, lastFetchedAt: undefined });
    await t.p.catalog.ingestFeeds.execute();
    assert.equal((await t.store.repos.articles.find({ topic: "tarifas de gas" })).filter((a) => a.outletId === "nortehoy").length, 1);

    // La comparación ya encuentra la nota real (proveedor de notas guardadas).
    const cmp = await t.p.core.compareSources.execute({ topic: "tarifas de gas", period: { from: new Date("2026-01-01"), to: new Date("2026-09-30") } });
    assert.ok(cmp.outletIds.includes("nortehoy"));

    // Y la credibilidad usa los datos importados: dueño minero/energético + pauta por alias.
    const rep = await t.p.core.evaluateCredibility.evaluate({ outletId: "nortehoy", topic: "tarifas de gas", period: { from: new Date("2026-01-01"), to: new Date("2026-09-30") } });
    const ads = rep.dimensions.find((d) => d.dimensionId === "official_advertising")!;
    assert.match(ads.summary, /Gobierno de Salta/);
    assert.ok(ads.score! < 1);
  });

  test("un feed caído queda marcado y no frena a los demás", async () => {
    const { t } = await withCatalog();
    await t.store.repos.outlets.save({ id: "nortehoy", name: "Norte Hoy", url: "https://nortehoy.example", kind: "digital", region: { country: "AR" } });
    await t.store.repos.catalog.saveFeed({ id: "f1", outletId: "nortehoy", url: "https://caido.example/rss", active: true });
    await t.store.repos.catalog.saveFeed({ id: "f2", outletId: "nortehoy", url: "https://nortehoy.example/rss", active: true });
    const r = await t.p.catalog.ingestFeeds.execute();
    assert.deepEqual(r, { feeds: 2, articles: 2, errors: 1 });
    const broken = (await t.store.repos.catalog.findActiveFeeds()).find((f) => f.id === "f1")!;
    assert.match(broken.lastError ?? "", /404/);
  });

  test("clasificador de temas por palabras clave", async () => {
    const c = new KeywordTopicClassifier(TOPICS);
    assert.equal(await c.classify("El INDEC publicó la inflación de agosto"), "inflación");
    assert.equal(await c.classify("Récord de turistas en la costa"), undefined);
  });

  test("la ingesta corre como trabajo periódico", async () => {
    const { t, admin } = await withCatalog();
    await t.p.catalog.import.execute({ actorId: admin.id, sourceId: "medios" });
    await t.p.jobs.scheduler.tick();
    await t.p.jobs.worker().runOnce();
    assert.equal((await t.store.repos.articles.find({ topic: "tarifas de gas" })).filter((a) => a.outletId === "nortehoy").length, 1);
  });
});

/** Detector "malo" para probar la barrera contra regresiones. */
class NeverSmoke implements ISmokeDetector {
  readonly version = "reglas-nunca";
  async analyze(): Promise<SmokeAnalysis> {
    return { smokeIndex: 0, findings: [], cleanVersion: "", keyFacts: [] } as unknown as SmokeAnalysis;
  }
}

describe("Calidad medible del detector", () => {
  test("métricas: exactitud, precisión, exhaustividad y F1, también por tipo", () => {
    const m = computeMetrics([
      { expected: { isSmoke: true, types: ["alarmism"] }, got: { isSmoke: true, types: ["alarmism"] } },
      { expected: { isSmoke: true, types: ["filler"] }, got: { isSmoke: false, types: [] } },
      { expected: { isSmoke: false, types: [] }, got: { isSmoke: true, types: ["marketing"] } },
      { expected: { isSmoke: false, types: [] }, got: { isSmoke: false, types: [] } },
    ]);
    assert.equal(m.accuracy, 0.5);
    assert.equal(m.precision, 0.5);
    assert.equal(m.recall, 0.5);
    assert.equal(m.f1, 0.5);
    assert.deepEqual(m.perType.alarmism, { precision: 1, recall: 1, support: 1 });
    assert.equal(m.perType.marketing?.precision, 0);
  });

  test("evalúa la versión en uso con el set semilla y guarda sus métricas y fallas", async () => {
    const t = await testPlatform();
    const qa = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["fact_checker"]);
    const run = await t.p.quality.evaluateCurrent(qa.id);
    assert.equal(run.metrics.examples, SEED_EVALUATION_SET.length);
    assert.match(run.modelVersion, /^reglas-/);
    assert.ok(run.metrics.accuracy >= 0.8, `exactitud ${run.metrics.accuracy}`);
    assert.equal(run.metrics.precision, 1, "no inventa humo en textos informativos");
    assert.equal(run.failures.length, Math.round((1 - run.metrics.accuracy) * run.metrics.examples), "las fallas quedan para revisar");
    const v = await t.store.repos.quality.findVersion(run.modelVersion);
    assert.equal(v?.status, "candidate");
    assert.deepEqual(v?.lastEvaluation, run.metrics);
  });

  test("una versión peor no se puede activar (barrera contra regresiones)", async () => {
    const t = await testPlatform();
    const qa = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["fact_checker"]);
    const good = await t.p.quality.evaluateCurrent(qa.id);
    const active = await t.p.quality.service.promote({ actorId: qa.id, versionId: good.modelVersion });
    assert.equal(active.status, "active");

    const bad = await t.p.quality.service.evaluate({ actorId: qa.id, detector: new NeverSmoke() });
    assert.equal(bad.metrics.recall, 0);
    await assert.rejects(t.p.quality.service.promote({ actorId: qa.id, versionId: bad.modelVersion }), ConflictError);
    assert.equal((await t.store.repos.quality.findVersion(good.modelVersion))?.status, "active", "la buena sigue activa");

    const reader = await userWithPlan(t, "empresa");
    await assert.rejects(t.p.quality.evaluateCurrent(reader.id), AccessDeniedError);
  });

  test("el set semilla se carga una sola vez y no pisa correcciones del equipo", async () => {
    const t = await testPlatform();
    const [first] = await t.store.repos.quality.findExamples();
    await t.store.repos.quality.saveExample({ ...first!, note: "corregido" });
    await seedPlatform(t.store);
    const all = await t.store.repos.quality.findExamples();
    assert.equal(all.length, SEED_EVALUATION_SET.length);
    assert.equal(all.find((e) => e.id === first!.id)?.note, "corregido");
  });
});

describe("¿Te sirvió?", () => {
  const CHAIN = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario.";

  test("cada análisis pregunta; SÍ/NO por chat queda asociado al análisis y a la versión", async () => {
    const t = await testPlatform();
    const from = "+5491177770001";
    const r = await t.p.inbound.execute(wa(from, CHAIN, t.clock.now()));
    assert.ok(r.response.footer?.includes(FEEDBACK_ASK));
    assert.ok(t.whatsapp.outbox.at(-1)!.text.includes("¿Te sirvió?"));

    t.clock.advance(60_000);
    const yes = await t.p.inbound.execute(wa(from, "Sí", t.clock.now()));
    assert.match(yes.response.title, /Gracias/);
    const [fb] = await t.store.repos.quality.findFeedback(new Date(0));
    assert.equal(fb?.useful, true);
    assert.match(fb?.modelVersion ?? "", /^reglas-/);

    // Cambia de opinión: una sola opinión por análisis, y el "no" crea un ejemplo PENDIENTE de revisión.
    const no = await t.p.inbound.execute(wa(from, "NO", t.clock.now()));
    assert.match(no.response.title, /revisar/);
    const all = await t.store.repos.quality.findFeedback(new Date(0));
    assert.equal(all.length, 1);
    assert.equal(all[0]!.useful, false);
    const pending = (await t.store.repos.quality.findExamples()).filter((e) => !e.reviewed);
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.source, "feedback");
    assert.equal(pending[0]!.expected.isSmoke, false, "si dijo que se equivocó, se propone la etiqueta contraria");

    // Mientras no se revise, no cuenta en la evaluación.
    const qa = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["fact_checker"]);
    assert.equal((await t.p.quality.evaluateCurrent(qa.id)).metrics.examples, SEED_EVALUATION_SET.length);
    await t.p.quality.service.reviewExample({ actorId: qa.id, exampleId: pending[0]!.id, isSmoke: true, types: ["chain_call"] });
    assert.equal((await t.p.quality.evaluateCurrent(qa.id)).metrics.examples, SEED_EVALUATION_SET.length + 1);

    const rate = await t.p.quality.feedback.usefulnessByVersion(new Date(0));
    assert.equal(Object.values(rate)[0]!.rate, 0);
  });

  test("un 'no' sin análisis reciente se trata como un mensaje más", async () => {
    const t = await testPlatform();
    const r = await t.p.inbound.execute(wa("+5491177770002", "no", t.clock.now()));
    assert.doesNotMatch(r.response.title, /Gracias/);
    assert.equal((await t.store.repos.quality.findFeedback(new Date(0))).length, 0);
  });

  test("nadie puede opinar sobre el análisis de otro", async () => {
    const t = await testPlatform();
    await t.p.inbound.execute(wa("+5491177770003", CHAIN, t.clock.now()));
    const u = await t.store.repos.users.findByChannel("whatsapp", "+5491177770003");
    const [a] = await t.store.repos.contentAnalyses.findByUser(u!.id, 1);
    const other = await userWithPlan(t, "gratis");
    await assert.rejects(t.p.quality.feedback.submit({ userId: other.id, analysisId: a!.id, useful: true }));
  });
});

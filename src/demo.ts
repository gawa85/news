/**
 * Demo de punta a punta, sin conexión (motor de reglas + datos ficticios en memoria).
 * Para usar IA: cambiar `ai` en buildApp por { provider: "anthropic", apiKey, model }.
 */
import { buildApp, seedCore } from "./composition/container";
import { createMemoryStore } from "./infrastructure/persistence/stores";
import { SMOKE_LABELS, type CredibilityReport } from "./domain/model";
import { DEMO_TOPIC, demoDate, demoSeed } from "./demo/seedData";
import { FixedClock, SilentLogger } from "./infrastructure/system/System";

const title = (s: string) => console.log(`\n${"=".repeat(70)}\n${s}\n${"=".repeat(70)}`);
const pct = (n: number | null) => (n === null ? "sin datos" : `${Math.round(n * 100)}/100`);

async function main() {
  const store = createMemoryStore();
  await store.migrate();
  await seedCore(store, demoSeed);
  const app = buildApp({ store, ai: { provider: "rules" }, fetcher: "memory", seed: demoSeed, clock: new FixedClock(demoDate("2026-09-23")), logger: new SilentLogger() });
  const outletName = async (id: string) => (await app.admin.outlets.findById(id))?.name ?? id;

  // 1. Detector de humo
  title("1. DETECTOR DE HUMO");
  const smoke = await app.analyzeSmoke.execute({ text: demoSeed.searchableArticles[1]!.body });
  console.log(`Índice de humo: ${smoke.smokeIndex}/100`);
  smoke.findings.forEach((f) => console.log(`  - ${SMOKE_LABELS[f.type]}: "${f.excerpt}" → ${f.explanation}`));
  console.log(`Versión limpia: ${smoke.cleanVersion}`);

  // 2. Comparación de fuentes con URLs incluidas y excluidas
  title("2. COMPARACIÓN DE FUENTES (marzo 2026)");
  const cmp = await app.compareSources.execute({
    topic: DEMO_TOPIC,
    period: { from: demoDate("2026-03-01"), to: demoDate("2026-03-31") },
    urlRules: {
      include: ["https://revista-energia.example/analisis/tarifas-gas-2026", "https://no-existe.example/nota"],
      exclude: ["opinionesya.example"],
    },
  });
  console.log(`Reglas de URL → incluidas: ${cmp.urlRules.included.length}, descartadas por filtro: ${cmp.urlRules.filteredOut}`);
  cmp.urlRules.failedIncludes.forEach((f) => console.log(`  ! No se pudo incluir ${f.url}: ${f.reason}`));
  console.log(`Fuentes: ${(await Promise.all(cmp.outletIds.map(outletName))).join(", ")}`);
  console.log("\nEN QUÉ COINCIDEN TODAS:");
  cmp.agreements.forEach((c) => console.log(`  ✓ ${c.summary}`));
  console.log("EN QUÉ COINCIDEN VARIAS:");
  for (const c of cmp.partialAgreements) console.log(`  ~ ${c.summary}  [${(await Promise.all(c.outletIds.map(outletName))).join(", ")}]`);
  console.log("EN QUÉ DIFIEREN:");
  for (const dis of cmp.disagreements) {
    console.log(`  ✗ (${dis.type}) ${dis.description}`);
    for (const p of dis.positions) console.log(`      ${await outletName(p.outletId)}: "${p.claimText}"`);
  }
  console.log("QUÉ NO MENCIONA CADA UNA:");
  for (const o of cmp.omissions) {
    const missing = o.missingClusterIds.map((id) => [...cmp.agreements, ...cmp.partialAgreements].find((c) => c.id === id)?.summary).filter(Boolean);
    if (missing.length) console.log(`  – ${await outletName(o.outletId)} no menciona: ${missing.map((m) => `"${m}"`).join("; ")}`);
  }
  console.log("PREGUNTAS ABIERTAS:");
  cmp.openQuestions.forEach((q) => console.log(`  ? ${q}`));

  // 3. ¿Quién lo dijo primero?
  title("3. ¿QUIÉN LO DIJO PRIMERO? (nota de El Diario del Valle)");
  const trace = await app.traceOrigin.execute({ articleId: "ddv-1" });
  console.log(`Origen: ${await outletName(trace.origin.outletId)} (${trace.origin.publishedAt.toISOString().slice(0, 10)})`);
  for (const l of trace.chain) console.log(`  - ${await outletName(l.article.outletId)}: parecido ${l.similarityToOrigin}${l.isNearCopy ? "  ← casi copia" : ""}`);
  console.log(`¿Gacetilla o cable de agencia? ${trace.likelyPressRelease ? "probablemente sí" : "no parece"}`);
  if (trace.echoWarning) console.log(`Aviso: ${trace.echoWarning}`);

  // 4. Ingesta del período completo + verificaciones posteriores + credibilidad
  title("4. MEDIDOR DE CREDIBILIDAD (tema: tarifas de gas, ene–ago 2026)");
  const fullPeriod = { from: demoDate("2026-01-01"), to: demoDate("2026-08-31") };
  await app.ingestArticles.execute({ topic: DEMO_TOPIC, period: fullPeriod, urlRules: { exclude: ["opinionesya.example"] } });

  // Verificaciones cargadas por el equipo de chequeo (simuladas).
  const allArticles = await app.admin.articles.find({ topic: DEMO_TOPIC });
  const allClaims = await app.admin.claims.findByArticleIds(allArticles.map((a) => a.id));
  for (const c of allClaims.filter((x) => x.kind === "fact")) {
    const status = c.text.includes("30%") ? "confirmed" : c.text.includes("18%") || c.text.includes("5% en septiembre") ? "refuted" : null;
    if (status) await app.admin.verdicts.save({ claimId: c.id, status, checkedAt: demoDate("2026-09-01") });
  }

  for (const outletId of ["ddv", "lvc"]) printReport(await app.evaluateCredibility.evaluate({ outletId, topic: DEMO_TOPIC, period: fullPeriod }));

  // 5. Línea de tiempo
  title("5. LÍNEA DE TIEMPO — El Diario del Valle (2 períodos)");
  const timeline = await app.credibilityTimeline.execute({ outletId: "ddv", topic: DEMO_TOPIC, period: fullPeriod }, 2);
  for (const p of timeline) {
    console.log(`${p.period.from.toISOString().slice(0, 10)} → ${p.period.to.toISOString().slice(0, 10)}: ` +
      p.report.dimensions.map((dm) => `${dm.label}: ${pct(dm.score)}`).join(" | "));
  }
}

function printReport(r: CredibilityReport) {
  console.log(`\n▶ ${r.outletName} — ${r.sampleSize} notas analizadas — resumen: ${pct(r.overall)}`);
  for (const dm of r.dimensions) {
    console.log(`  • ${dm.label}: ${pct(dm.score)} (confianza ${Math.round(dm.confidence * 100)}%)`);
    console.log(`      ${dm.summary}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

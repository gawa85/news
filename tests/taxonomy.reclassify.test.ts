/** Más temas y volver a clasificar las notas del catálogo que habían quedado en "otros". */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SEED_TOPICS } from "../src/config/topics";
import { seedTaxonomy } from "../src/application/config/Taxonomy";
import { countByTopic } from "../src/application/catalog/CatalogUseCases";
import { SEED_CATEGORIES } from "../src/config/topics";
import type { Article } from "../src/domain/model";
import { testPlatform } from "./helpers/platform";
import { post, startWebApi } from "./helpers/webSession";

const nota = (id: string, title: string, topic = "otros"): Article => ({
  id: `reclas-${id}`, outletId: "reclas-medio", url: `https://reclas.example/${id}`, title, body: "",
  publishedAt: new Date("2026-09-29T10:00:00Z"), region: { country: "AR" }, topic,
});

type Report = { checked: number; changed: number; byTopic: { topic: string; articles: number }[] };

describe("Temas: más temas y reclasificar notas", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let web: Awaited<ReturnType<typeof startWebApi>>;
  const topicOf = async (id: string) => (await t.store.repos.articles.findById(`reclas-${id}`))!.topic;

  before(async () => {
    t = await testPlatform();
    web = await startWebApi(t);
  });
  after(() => web.close());

  test("la semilla: ids y nombres sin repetir, cada tema con palabras clave y una categoría que existe", () => {
    assert.equal(new Set(SEED_TOPICS.map((x) => x.id)).size, SEED_TOPICS.length);
    assert.equal(new Set(SEED_TOPICS.map((x) => x.name)).size, SEED_TOPICS.length);
    const cats = new Set(SEED_CATEGORIES.map((c) => c.id));
    for (const x of SEED_TOPICS) {
      assert.ok(cats.has(x.categoryId), x.id);
      assert.ok(x.keywords.length > 0, x.id);
    }
    for (const x of ["deportes", "internacional", "justicia", "congreso", "gobierno", "espectaculos", "clima", "tecnologia"]) assert.ok(SEED_TOPICS.some((s) => s.id === x), x);
  });

  test("reclasificar 'otros': las notas encuentran su tema; lo ya clasificado no se toca; dos veces no cambia nada", async () => {
    await t.store.repos.articles.saveMany([
      nota("futbol", "El once que prepara Scaloni para el amistoso de la Selección Argentina"),
      nota("corte", "La Corte Suprema revocó el fallo sobre la Ley de Tierras"),
      nota("lluvias", "Alerta meteorológica: llegan lluvias y tormentas fuertes"),
      nota("nada", "¿Para qué sirve enojarse?"),
      nota("fijo", "Un tema que ya estaba puesto a mano", "salud"),
    ]);
    const admin = await web.login("admin.reclasificar@correo.example", ["platform_admin"]);
    const r = (await (await admin("/v1/taxonomy/reclassify", post({ scope: "otros" }))).json()) as Report;
    assert.ok(r.checked >= 4);
    assert.ok(r.changed >= 3);
    assert.deepEqual([await topicOf("futbol"), await topicOf("corte"), await topicOf("lluvias"), await topicOf("nada"), await topicOf("fijo")], ["deportes", "justicia", "clima y ambiente", "otros", "salud"]);
    assert.ok(r.byTopic.some((x) => x.topic === "otros"));

    const again = (await (await admin("/v1/taxonomy/reclassify", post({}))).json()) as Report;
    assert.equal(again.changed, 0, "idempotente");
  });

  test("sólo con permiso para editar temas; el alcance tiene que ser válido", async () => {
    const reader = await web.login("lector.reclasificar@correo.example");
    assert.equal((await reader("/v1/taxonomy/reclassify", post({}))).status, 403);
    const admin = await web.login("admin2.reclasificar@correo.example", ["platform_admin"]);
    assert.equal((await admin("/v1/taxonomy/reclassify", post({ scope: "cualquiera" }))).status, 400);
  });

  test("conteo por tema: de mayor a menor y 'otros' siempre al final", () => {
    const list = ["otros", "otros", "otros", "deportes", "justicia", "deportes"].map((topic) => ({ topic }));
    assert.deepEqual(countByTopic(list), [
      { topic: "deportes", articles: 2 },
      { topic: "justicia", articles: 1 },
      { topic: "otros", articles: 3 },
    ]);
  });

  test("la semilla actualiza las palabras de los temas que nadie editó, y no pisa los editados a mano", async () => {
    const repo = t.store.repos.taxonomy;
    const gas = (await repo.findTopics()).find((x) => x.id === "tarifas-gas")!;
    const luz = (await repo.findTopics()).find((x) => x.id === "tarifas-luz")!;
    await repo.saveTopic({ ...gas, keywords: ["vieja"], updatedBy: "sistema" });
    await repo.saveTopic({ ...luz, keywords: ["a mano"], updatedBy: "usuario-equipo" });
    await seedTaxonomy(repo, { categories: SEED_CATEGORIES, topics: SEED_TOPICS }, new Date());
    const after2 = await repo.findTopics();
    assert.deepEqual(after2.find((x) => x.id === "tarifas-gas")!.keywords, SEED_TOPICS.find((x) => x.id === "tarifas-gas")!.keywords);
    assert.deepEqual(after2.find((x) => x.id === "tarifas-luz")!.keywords, ["a mano"]);
  });
});

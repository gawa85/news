/** Documentos legales: páginas públicas con el texto y sus versiones; publicar una versión nueva desde el backoffice. */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { seedPlatform } from "../src/composition/platform";
import { testPlatform } from "./helpers/platform";
import { post, startWebApi } from "./helpers/webSession";

type Doc = { id: string; version: string; title: string; body?: string; material: boolean; draft: boolean; url: string; publishedBy?: string };
const BODY = `# Términos\n\n${"Texto de prueba con **negrita** y una lista:\n\n- uno\n- dos\n\n".repeat(5)}`;

describe("Web: documentos legales", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let web: Awaited<ReturnType<typeof startWebApi>>;

  before(async () => {
    t = await testPlatform();
    await seedPlatform(t.store, { legalTexts: { terms: "# Términos y condiciones\n\nTexto inicial." } });
    web = await startWebApi(t);
  });
  after(() => web.close());

  test("públicos: el texto vigente (el de docs/legal la primera vez), sin quién lo cargó; un documento inexistente, 404", async () => {
    const terms = (await (await fetch(`${web.base}/public/legal/terms`)).json()) as Doc;
    assert.equal(terms.version, "2026-09-borrador");
    assert.match(terms.body!, /Texto inicial/);
    assert.equal(terms.publishedBy, undefined);
    assert.equal((await fetch(`${web.base}/public/legal/otro`)).status, 404);
    assert.equal((await fetch(`${web.base}/public/legal/terms/1999-01-01`)).status, 404);
    const list = (await (await fetch(`${web.base}/public/legal`)).json()) as Doc[];
    assert.ok(list.every((d) => d.body === undefined), "el listado no trae los textos completos");
  });

  test("publicar: sólo con permiso; cada vez una versión nueva; un cambio importante pide aceptar de nuevo", async () => {
    const checker = await web.login("verif.legal@correo.example", ["fact_checker"]);
    const doc = { title: "Términos y condiciones", summary: "Qué es el servicio y sus límites.", body: BODY, material: false, draft: true };
    assert.equal((await checker("/v1/admin/legal/terms", post(doc))).status, 403);

    const admin = await web.login("admin.legal@correo.example", ["platform_admin"]);
    const reader = await web.login("lectora.legal@correo.example");
    const accept = async () => {
      for (const d of (await (await reader("/v1/legal/pending")).json()) as Doc[]) await reader("/v1/legal/accept", post({ docId: d.id, version: d.version }));
    };
    await accept();
    assert.deepEqual(await (await reader("/v1/legal/pending")).json(), []);

    assert.equal((await admin("/v1/admin/legal/terms", post({ ...doc, body: "corto" }))).status, 400);
    assert.equal((await admin("/v1/admin/legal/otro", post(doc))).status, 404);

    const minor = (await (await admin("/v1/admin/legal/terms", post(doc))).json()) as Doc;
    assert.equal(minor.version, t.clock.now().toISOString().slice(0, 10));
    assert.equal(minor.publishedBy, undefined);
    assert.deepEqual(await (await reader("/v1/legal/pending")).json(), [], "un cambio menor no pide aceptar de nuevo");

    const major = (await (await admin("/v1/admin/legal/terms", post({ ...doc, material: true, draft: false }))).json()) as Doc;
    assert.equal(major.version, `${minor.version}-2`, "misma fecha: con sufijo");
    assert.deepEqual(((await (await reader("/v1/legal/pending")).json()) as Doc[]).map((d) => [d.id, d.version]), [["terms", major.version]]);

    const versions = (await (await fetch(`${web.base}/public/legal/terms/versions`)).json()) as Doc[];
    assert.deepEqual(versions.map((v) => v.version), [major.version, minor.version, "2026-09-borrador"]);
    const old = (await (await fetch(`${web.base}/public/legal/terms/2026-09-borrador`)).json()) as Doc;
    assert.match(old.body!, /Texto inicial/, "las versiones anteriores se siguen pudiendo leer");

    const audit = (await (await admin("/v1/audit?action=legal.published")).json()) as { data: { version: string; material: boolean } }[];
    assert.ok(audit.some((e) => e.data.version === major.version && e.data.material));
  });
});

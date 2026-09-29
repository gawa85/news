/** Puesta en marcha: datos de la empresa, completar los legales y la lista de lo que falta para producción. */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { seedPlatform } from "../src/composition/platform";
import { fillLegalPlaceholders, remainingPlaceholders } from "../src/domain/model";
import { testPlatform } from "./helpers/platform";
import { startWebApi } from "./helpers/webSession";

/** Un CUIT válido a partir de sus 10 primeros dígitos (calcula el verificador). */
function cuit(first10: string): string {
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = first10.split("").reduce((a, d, i) => a + Number(d) * w[i]!, 0);
  const v = 11 - (sum % 11);
  return `${first10}${v === 11 ? 0 : v === 10 ? 9 : v}`;
}
const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body) });
const post = (body: unknown = {}) => ({ method: "POST", body: JSON.stringify(body) });
type Check = { id: string; status: string; detail: string; action?: { env?: string[]; href?: string } };

describe("Completar los datos de la empresa en un texto legal (regla pura)", () => {
  test("sólo los datos; plazos, proveedores y enlaces quedan como están", () => {
    const text = "Sin Humo es un servicio de [RAZÓN SOCIAL], CUIT [●], con domicilio en [●]. Contacto: [mail]. Guardamos [365] días. Ver la [Política de privacidad](/legal/privacidad). Datos entre [corchetes].";
    const out = fillLegalPlaceholders(text, { legalName: "Humo Cero S.A.", taxId: "30712345671", address: "Av. Siempreviva 742, CABA", contactEmail: "datos@sinhumo.example" });
    assert.match(out, /servicio de Humo Cero S\.A\., CUIT 30-71234567-1, con domicilio en Av\. Siempreviva 742, CABA\. Contacto: datos@sinhumo\.example\./);
    assert.deepEqual(remainingPlaceholders(out), ["[365]"], "ni el enlace ni la nota de [corchetes] cuentan");
  });
});

describe("Puesta en marcha", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let web: Awaited<ReturnType<typeof startWebApi>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof startWebApi>>["login"]>>;
  const checks = async () => ((await (await admin("/v1/admin/setup")).json()) as { checks: Check[] }).checks;
  const check = async (id: string) => (await checks()).find((c) => c.id === id)!;

  before(async () => {
    t = await testPlatform();
    await seedPlatform(t.store, {
      legalTexts: {
        terms: `# Términos\n\nSin Humo es un servicio de [RAZÓN SOCIAL], CUIT [●], con domicilio en [●]. Contacto: [mail].\n\n${"Texto de los términos. ".repeat(12)}\n\nLos precios cambian con aviso de [30] días.`,
        privacy: `# Privacidad\n\n**Responsable:** [RAZÓN SOCIAL], CUIT [●], domicilio [●]. Contacto: [mail]. Registro: [número, pendiente].\n\n${"Texto de la privacidad. ".repeat(12)}\n\nMayores de [13/16/18] años.`,
      },
    });
    web = await startWebApi(t);
    admin = await web.login("admin.puesta@correo.example", ["platform_admin"]);
  });
  after(() => web.close());

  test("sólo la administración de la plataforma", async () => {
    const orgAdmin = await web.login("admin.org.puesta@correo.example", ["org_admin"]);
    assert.equal((await orgAdmin("/v1/admin/setup")).status, 403);
    assert.equal((await orgAdmin("/v1/admin/setup/profile", put({ legalName: "x" }))).status, 403);
  });

  test("la lista sale del estado real y dice qué falta y dónde", async () => {
    const all = await checks();
    const byId = Object.fromEntries(all.map((c) => [c.id, c]));
    assert.equal(byId.empresa!.status, "todo");
    assert.equal(byId["legal-terms"]!.status, "todo", "borrador");
    assert.match(byId["legal-terms"]!.detail, /corchetes/);
    assert.equal(byId.mail!.status, "todo");
    assert.ok(byId.mail!.action!.env!.includes("SMTP_HOST"));
    assert.equal(byId.whatsapp!.status, "optional");
    assert.equal(byId.cobros!.status, "todo");
    assert.equal(byId.planes!.status, "ok");
    assert.equal(byId.equipo!.status, "warn", "una sola cuenta administra");
    assert.equal(byId.temas!.status, "ok");

    await web.login("segunda.admin.puesta@correo.example", ["platform_admin"]);
    assert.equal((await check("equipo")).status, "ok", "con dos, bien");
  });

  test("datos de la empresa: CUIT con verificador; completar los legales publica borradores nuevos sin pedir aceptar de nuevo", async () => {
    const base = { legalName: "Humo Cero S.A.", address: "Av. Siempreviva 742, CABA", contactEmail: "Datos@SinHumo.example", dataRegistryNumber: "RNBD 12345", minimumAge: 16 };
    assert.equal((await admin("/v1/admin/setup/profile", put({ ...base, taxId: "30-71234567-0" }))).status, 400, "verificador mal");
    assert.equal((await admin("/v1/admin/setup/profile", put({ ...base, taxId: cuit("3071234567"), contactEmail: "no-es-mail" }))).status, 400);
    assert.equal((await admin("/v1/admin/setup/fill-legal", post())).status, 400, "sin datos, no");
    const saved = await admin("/v1/admin/setup/profile", put({ ...base, taxId: cuit("3071234567"), updatedBy: "otra" }));
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as { contactEmail: string; updatedBy: string }).contactEmail, "datos@sinhumo.example");
    assert.equal((await check("empresa")).status, "ok");

    const reader = await web.login("lectora.puesta@correo.example");
    for (const d of (await (await reader("/v1/legal/pending")).json()) as { id: string; version: string }[]) await reader("/v1/legal/accept", post({ docId: d.id, version: d.version }));

    const r = (await (await admin("/v1/admin/setup/fill-legal", post())).json()) as { published: { docId: string }[]; remaining: Record<string, string[]> };
    assert.deepEqual(r.published.map((p) => p.docId).sort(), ["privacy", "terms"]);
    assert.deepEqual(r.remaining.terms, ["[30]"]);
    assert.deepEqual(r.remaining.privacy, []);
    const terms = (await (await fetch(`${web.base}/public/legal/terms`)).json()) as { body: string; draft: boolean };
    assert.match(terms.body, /Humo Cero S\.A\., CUIT 30-71234567-\d, con domicilio en Av\. Siempreviva 742, CABA\. Contacto: datos@sinhumo\.example/);
    assert.equal(terms.draft, true, "sigue siendo borrador hasta la revisión legal");
    const privacy = (await (await fetch(`${web.base}/public/legal/privacy`)).json()) as { body: string };
    assert.match(privacy.body, /Registro: RNBD 12345/);
    assert.match(privacy.body, /Mayores de 16 años/);
    assert.deepEqual(await (await reader("/v1/legal/pending")).json(), [], "completar datos no es un cambio importante");

    const again = (await (await admin("/v1/admin/setup/fill-legal", post())).json()) as { published: unknown[] };
    assert.deepEqual(again.published, [], "ya completos: no publica de nuevo");
  });
});

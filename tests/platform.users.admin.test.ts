/** Personas de la plataforma: buscar cuentas, roles del equipo, representantes de medios y suspensión. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { testPlatform, wa, withRoles } from "./helpers/platform";

const ORIGIN = "https://sinhumo.example";
const tokenFrom = (text: string) => text.match(/token=([\w-]+)/)![1]!;
const PHONE = "+5491155554444";

describe("Web: personas de la plataforma", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let base: string;
  let server: ReturnType<typeof createHttpApi>;

  const login = async (email: string, roles: string[] = []) => {
    t.clock.advance(3_600_001); // (el freno contra el abuso admite 5 altas por hora desde la misma IP)
    await fetch(`${base}/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const r = await fetch(`${base}/auth/magic?token=${tokenFrom(t.mail.sent.at(-1)!.text)}`, { redirect: "manual" });
    const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
    const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
      fetch(`${base}${path}`, { ...init, headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...init.headers } });
    const me = (await (await call("/v1/me")).json()) as { id: string };
    if (roles.length) await withRoles(t, me.id, roles);
    return Object.assign(call, { userId: me.id });
  };
  const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
  type U = { id: string; status: string; roleIds: string[]; representsOutletIds: string[]; suspension?: { reason: string } };

  before(async () => {
    t = await testPlatform();
    server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((r) => server.close(() => r())));

  test("sólo la administración de la plataforma; sin revelar si una cuenta existe", async () => {
    const orgAdmin = await login("admin.org@correo.example", ["org_admin"]);
    const other = await login("otra.persona@correo.example");
    assert.equal((await orgAdmin("/v1/admin/users")).status, 403);
    assert.equal((await orgAdmin(`/v1/admin/users/${other.userId}`)).status, 403);
    assert.equal((await orgAdmin("/v1/admin/users/no-existe")).status, 403, "igual que una que existe");
    assert.equal((await orgAdmin(`/v1/admin/users/${other.userId}/roles/add`, post({ roleId: "platform_admin" }))).status, 403);
  });

  test("buscar por mail o teléfono exactos; el equipo aparece sin buscar; dar y quitar roles", async () => {
    const admin = await login("admin.plataforma@correo.example", ["platform_admin"]);
    const ana = await login("ana.verifica@correo.example");
    await t.p.inbound.execute(wa(PHONE, "hola", t.clock.now()));

    const byMail = (await (await admin("/v1/admin/users?q=ANA.verifica@correo.example")).json()) as U[];
    assert.deepEqual(byMail.map((u) => u.id), [ana.userId]);
    const byPhone = (await (await admin(`/v1/admin/users?q=${encodeURIComponent("54 9 11 5555-4444")}`)).json()) as U[];
    assert.equal(byPhone.length, 1, "el teléfono se encuentra con o sin + y espacios");
    assert.deepEqual((await (await admin("/v1/admin/users?q=Ana")).json()) as U[], [], "no hay búsqueda por nombre");

    assert.equal((await admin(`/v1/admin/users/${ana.userId}/roles/add`, post({ roleId: "inventado" }))).status, 404);
    const withRole = (await (await admin(`/v1/admin/users/${ana.userId}/roles/add`, post({ roleId: "fact_checker" }))).json()) as U;
    assert.ok(withRole.roleIds.includes("fact_checker"));
    const staff = (await (await admin("/v1/admin/users")).json()) as U[];
    assert.ok(staff.some((u) => u.id === ana.userId) && staff.some((u) => u.id === admin.userId), "el equipo se lista sin buscar");
    assert.equal((await ana("/v1/verification/tasks")).status, 200, "el rol vale enseguida");

    const removed = (await (await admin(`/v1/admin/users/${ana.userId}/roles/remove`, post({ roleId: "fact_checker" }))).json()) as U;
    assert.ok(!removed.roleIds.includes("fact_checker"));
    assert.ok(!((await (await admin("/v1/admin/users")).json()) as U[]).some((u) => u.id === ana.userId));

    const roles = (await (await admin("/v1/admin/roles")).json()) as { id: string; scope: string }[];
    assert.ok(roles.some((r) => r.id === "fact_checker" && r.scope === "platform"));
  });

  test("nunca queda la plataforma sin administración; nadie se suspende a sí mismo", async () => {
    const admins = await t.store.repos.users.findWithRoles(["platform_admin"], 100);
    for (const a of admins) await t.store.repos.users.save({ ...a, roleIds: a.roleIds.filter((r) => r !== "platform_admin") });
    const solo = await login("unica.admin@correo.example", ["platform_admin"]);
    assert.equal((await solo(`/v1/admin/users/${solo.userId}/roles/remove`, post({ roleId: "platform_admin" }))).status, 409);
    assert.equal((await solo(`/v1/admin/users/${solo.userId}/suspend`, post({ reason: "prueba de suspenderme" }))).status, 409);

    const second = await login("segunda.admin@correo.example", ["platform_admin"]);
    assert.equal((await solo(`/v1/admin/users/${solo.userId}/roles/remove`, post({ roleId: "platform_admin" }))).status, 200, "con otra, sí");
    assert.equal((await second(`/v1/admin/users/${solo.userId}`)).status, 200);
  });

  test("suspender: corta la sesión y el chat al instante, con motivo en la auditoría; reactivar lo devuelve", async () => {
    const admin = await login("admin.suspende@correo.example", ["platform_admin"]);
    const juan = await login("juan.suspendido@correo.example");
    const chat = (await t.p.inbound.execute(wa("+5491166667777", "hola", t.clock.now()))).user;

    assert.equal((await admin(`/v1/admin/users/${juan.userId}/suspend`, post({ reason: "corto" }))).status, 400, "el motivo es obligatorio");
    const s = (await (await admin(`/v1/admin/users/${juan.userId}/suspend`, post({ reason: "Spam repetido en eventos en vivo" }))).json()) as U;
    assert.equal(s.status, "suspended");
    assert.equal(s.suspension?.reason, "Spam repetido en eventos en vivo");
    const me = await juan("/v1/me");
    assert.ok(me.status !== 200 || (await me.json()) === null, "la sesión ya no vale");
    assert.equal((await admin(`/v1/admin/users/${juan.userId}/suspend`, post({ reason: "Spam repetido en eventos en vivo" }))).status, 409, "ya estaba suspendida");

    assert.equal((await admin(`/v1/admin/users/${chat.id}/suspend`, post({ reason: "Cadenas falsas masivas" }))).status, 200);
    const r = await t.p.inbound.execute(wa("+5491166667777", "/soporte no anda", t.clock.now()));
    assert.match(JSON.stringify(r.response), /suspendida/);
    assert.equal((await t.store.repos.tickets.findByRequester(chat.id)).length, 0, "no abrió un ticket");

    const suspended = (await (await admin("/v1/admin/users?filter=suspended")).json()) as U[];
    assert.ok(suspended.some((u) => u.id === juan.userId) && suspended.some((u) => u.id === chat.id));

    const back = (await (await admin(`/v1/admin/users/${juan.userId}/reactivate`, post({ reason: "Aclaró que fue un error" }))).json()) as U;
    assert.equal(back.status, "active");
    assert.equal(back.suspension, undefined);

    const audit = (await (await admin("/v1/audit?action=user.suspended")).json()) as { data: { reason: string }; target: { id: string } }[];
    assert.ok(audit.some((e) => e.target.id === juan.userId && e.data.reason === "Spam repetido en eventos en vivo"));
  });

  test("representante de un medio: acreditar y quitar (sin medios, deja el rol)", async () => {
    const admin = await login("admin.medios@correo.example", ["platform_admin"]);
    const rep = await login("prensa@diario.example");
    const [outlet] = await t.store.repos.outlets.findAll();
    assert.equal((await admin(`/v1/admin/users/${rep.userId}/outlets/add`, post({ outletId: "no-existe" }))).status, 404);
    const added = (await (await admin(`/v1/admin/users/${rep.userId}/outlets/add`, post({ outletId: outlet!.id }))).json()) as U;
    assert.deepEqual(added.representsOutletIds, [outlet!.id]);
    assert.ok(added.roleIds.includes("outlet_rep"));
    const removed = (await (await admin(`/v1/admin/users/${rep.userId}/outlets/remove`, post({ outletId: outlet!.id }))).json()) as U;
    assert.deepEqual(removed.representsOutletIds, []);
    assert.ok(!removed.roleIds.includes("outlet_rep"));
  });
});

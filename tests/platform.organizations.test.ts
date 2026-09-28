/** Organizaciones: crear, invitar por mail, aceptar, roles, sacar a alguien e irse. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AccessDeniedError, ConflictError, ValidationError } from "../src/domain/errors";
import { testPlatform, userWithPlan } from "./helpers/platform";

type T = Awaited<ReturnType<typeof testPlatform>>;
const withEmail = async (t: T, address: string, name = address.split("@")[0]!) =>
  t.p.users.register.execute({ name, channel: { type: "email", address, verified: true } });
const tokenFromMail = (t: T, to: string) => {
  const mail = [...t.mail.sent].reverse().find((m) => m.to === to);
  assert.ok(mail, `no le llegó nada a ${to}`);
  return mail.text.match(/unirme\?token=([\w-]+)/)![1]!;
};

describe("Organizaciones", () => {
  test("crear, invitar, aceptar sólo con el mail invitado y lugares del plan", async () => {
    const t = await testPlatform();
    const O = t.p.organizations;
    const ana = await withEmail(t, "ana@medio.example", "Ana");
    const created = await O.create({ actorId: ana.id, name: "Diario Norte" });
    assert.equal(created.canManage, true);
    assert.deepEqual([created.plan.id, created.seats.used, created.seats.limit], ["equipo", 1, 10]);
    await assert.rejects(O.create({ actorId: ana.id, name: "Otra" }), ConflictError);

    const inv = await O.invite({ actorId: ana.id, email: "Juan@Medio.example" });
    assert.equal(inv.email, "juan@medio.example");
    const token = tokenFromMail(t, "juan@medio.example");
    const preview = await O.preview(token);
    assert.deepEqual([preview.organization, preview.invitedBy], ["Diario Norte", "Ana"]);

    // Otra persona con el enlace reenviado no puede usarlo.
    const intruso = await withEmail(t, "intruso@correo.example");
    await assert.rejects(O.accept({ actorId: intruso.id, token }), /es para juan@medio.example/);

    const juan = await withEmail(t, "juan@medio.example", "Juan");
    const joined = await O.accept({ actorId: juan.id, token });
    assert.equal(joined.canManage, false);
    assert.deepEqual(joined.members.map((m) => m.name).sort(), ["Ana", "Juan"]);
    assert.equal(joined.members.find((m) => m.name === "Ana")!.email, undefined, "sin administrar no se ven los mails");
    assert.deepEqual((await t.store.repos.users.findById(juan.id))!.roleIds, ["reader"]);
    await assert.rejects(O.accept({ actorId: juan.id, token }), /venció o ya se usó/);
    await assert.rejects(O.invite({ actorId: juan.id, email: "x@y.example" }), AccessDeniedError);
    await assert.rejects(O.invite({ actorId: ana.id, email: "juan@medio.example" }), /ya es parte/);

    // Reinvitar al mismo mail reemplaza la invitación (no ocupa otro lugar) y la vieja deja de servir.
    await O.invite({ actorId: ana.id, email: "eva@medio.example" });
    const old = tokenFromMail(t, "eva@medio.example");
    await O.invite({ actorId: ana.id, email: "eva@medio.example" });
    const view = await O.overview(ana.id);
    assert.equal(view.invitations.length, 1);
    assert.equal(view.seats.used, 3);
    await assert.rejects(O.preview(old), /venció o ya se usó/);
    await O.revokeInvitation({ actorId: ana.id, invitationId: view.invitations[0]!.id });
    assert.equal((await O.overview(ana.id)).seats.used, 2);
  });

  test("no se escala: roles de organización con permisos que tiene quien los da; el lugar se respeta", async () => {
    const t = await testPlatform();
    const O = t.p.organizations;
    const ana = await withEmail(t, "ana@medio.example", "Ana");
    await O.create({ actorId: ana.id, name: "Diario Norte" });
    await assert.rejects(O.invite({ actorId: ana.id, email: "a@b.example", roleId: "platform_admin" }), /No podés dar ese rol/);
    const roles = (await O.overview(ana.id)).roles.map((r) => r.id);
    assert.ok(roles.includes("moderator") && roles.includes("reader"));
    assert.ok(!roles.includes("fact_checker"), "los roles de plataforma no se ofrecen");

    // Plan con lugares justos: el que no entra se rechaza.
    const org = (await O.overview(ana.id)).organization.id;
    const sub = await t.store.repos.subscriptions.findCurrent({ type: "organization", id: org });
    const plan = (await t.store.repos.plans.findById("equipo"))!;
    await t.store.repos.plans.save({ ...plan, id: "equipo2", limits: { ...plan.limits, seats: 2 } });
    await t.store.repos.subscriptions.save({ ...sub!, planId: "equipo2" });
    await O.invite({ actorId: ana.id, email: "uno@medio.example" });
    await assert.rejects(O.invite({ actorId: ana.id, email: "dos@medio.example" }), /permite 2 personas/);
  });

  test("roles, sacar a alguien e irse: nunca queda sin administrador y quien sale vuelve a Gratis", async () => {
    const t = await testPlatform();
    const O = t.p.organizations;
    const ana = await withEmail(t, "ana@medio.example", "Ana");
    await O.create({ actorId: ana.id, name: "Diario Norte" });
    const join = async (email: string) => {
      await O.invite({ actorId: ana.id, email });
      const u = await withEmail(t, email);
      await O.accept({ actorId: u.id, token: tokenFromMail(t, email) });
      return u;
    };
    const juan = await join("juan@medio.example");
    const eva = await join("eva@medio.example");

    await assert.rejects(O.leave(ana.id), /única persona que administra/);
    const after = await O.setRole({ actorId: ana.id, memberId: juan.id, roleId: "org_admin" });
    assert.deepEqual(after.members.find((m) => m.id === juan.id)!.roleIds, ["org_admin"], "queda un solo rol de organización");
    await O.setRole({ actorId: ana.id, memberId: juan.id, roleId: "moderator" });
    assert.deepEqual((await t.store.repos.users.findById(juan.id))!.roleIds, ["moderator"]);

    await assert.rejects(O.removeMember({ actorId: juan.id, memberId: eva.id }), AccessDeniedError);
    await assert.rejects(O.removeMember({ actorId: ana.id, memberId: ana.id }), ValidationError);
    await O.removeMember({ actorId: ana.id, memberId: eva.id });
    const evaNow = (await t.store.repos.users.findById(eva.id))!;
    assert.equal(evaNow.organizationId, undefined);
    assert.equal((await t.p.access.planOf(evaNow)).plan.id, "gratis");

    await O.leave(juan.id);
    assert.equal((await O.overview(ana.id)).members.length, 1);
    await O.leave(ana.id); // única persona: puede irse
  });

  test("con un plan personal pago vigente, primero se cancela", async () => {
    const t = await testPlatform();
    const O = t.p.organizations;
    const ana = await withEmail(t, "ana@medio.example");
    await O.create({ actorId: ana.id, name: "Diario Norte" });
    await O.invite({ actorId: ana.id, email: "pro@medio.example" });
    const pro = await userWithPlan(t, "profesional");
    pro.channels.push({ channel: "email", address: "pro@medio.example", verified: true, linkedAt: new Date() } as never);
    await t.store.repos.users.save(pro);
    await assert.rejects(O.accept({ actorId: pro.id, token: tokenFromMail(t, "pro@medio.example") }), /Cancelalo/);
  });
});

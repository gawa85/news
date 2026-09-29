/** Configurar la cuenta: vincular WhatsApp o Telegram desde la web y la guía de bienvenida. */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { drainJobs, testPlatform, wa } from "./helpers/platform";
import { post, startWebApi } from "./helpers/webSession";

type Code = { code: string; expiresAt: string; whatsappUrl?: string; telegramUrl?: string };
const tg = (from: string, text: string, at: Date) => ({ channel: "telegram" as const, from, text, receivedAt: at, externalId: `tg-${Math.random()}` });

describe("Vincular WhatsApp o Telegram desde la web", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let web: Awaited<ReturnType<typeof startWebApi>>;

  before(async () => {
    t = await testPlatform({ extra: { chatLinks: { whatsappNumber: "+54 9 11 5000-0000", telegramBot: "@SinHumoBot" } } });
    web = await startWebApi(t);
  });
  after(() => web.close());

  const codeFor = async (call: Awaited<ReturnType<typeof web.login>>) => (await (await call("/v1/me/channels/link-code", post({}))).json()) as Code;
  const channelsOf = async (id: string) => (await t.store.repos.users.findById(id))!.channels.map((c) => `${c.channel}:${c.address}`);

  test("la web da un código y los botones; mandarlo desde el chat vincula ese número (una sola vez) y avisa por mail", async () => {
    const ana = await web.login("ana.vincula@correo.example");
    const c = await codeFor(ana);
    assert.match(c.code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(c.whatsappUrl, `https://wa.me/5491150000000?text=${encodeURIComponent(`VINCULAR ${c.code}`)}`);
    assert.equal(c.telegramUrl, `https://t.me/SinHumoBot?start=${c.code}`);

    const r = await t.p.inbound.execute(wa("+5491144440001", `vincular ${c.code.toLowerCase()}`, t.clock.now()));
    assert.equal(r.user.id, ana.userId);
    assert.match(JSON.stringify(r.response), /quedó vinculado/);
    assert.ok((await channelsOf(ana.userId)).includes("whatsapp:+5491144440001"));
    // (acababa de salir el mail para entrar: por el límite por persona, el aviso sale al minuto)
    t.clock.advance(61_000);
    await drainJobs(t);
    assert.ok(t.mail.sent.some((m) => /Vinculaste WhatsApp/.test(m.text) && /Si no fuiste vos/.test(m.text)));

    const again = await t.p.inbound.execute(wa("+5491144440009", `VINCULAR ${c.code}`, t.clock.now()));
    assert.notEqual(again.user.id, ana.userId, "un solo uso");
    assert.match(JSON.stringify(again.response), /no sirve o ya venció/);
  });

  test("Telegram: el enlace abre el bot con /start <código>", async () => {
    const bea = await web.login("bea.vincula@correo.example");
    const c = await codeFor(bea);
    const r = await t.p.inbound.execute(tg("99887766", `/start ${c.code}`, t.clock.now()) as never);
    assert.equal(r.user.id, bea.userId);
    assert.ok((await channelsOf(bea.userId)).includes("telegram:99887766"));
  });

  test("pedir otro código invalida el anterior; un número de otra cuenta no se roba", async () => {
    const caro = await web.login("caro.vincula@correo.example");
    const first = await codeFor(caro);
    const second = await codeFor(caro);
    const r1 = await t.p.inbound.execute(wa("+5491144440002", `VINCULAR ${first.code}`, t.clock.now()));
    assert.match(JSON.stringify(r1.response), /no sirve o ya venció/);

    // +5491144440002 ya escribió antes (tiene su propia cuenta de chat): no se pasa a otra cuenta.
    const r2 = await t.p.inbound.execute(wa("+5491144440002", `VINCULAR ${second.code}`, t.clock.now()));
    assert.match(JSON.stringify(r2.response), /ya está vinculado a otra cuenta/);
    assert.ok(!(await channelsOf(caro.userId)).includes("whatsapp:+5491144440002"));
  });

  test("probar códigos al azar: a los 5 errores, ese número queda frenado (aunque después acierte)", async () => {
    const dani = await web.login("dani.vincula@correo.example");
    const phone = "+5491144440003";
    for (let i = 0; i < 5; i++) await t.p.inbound.execute(wa(phone, `VINCULAR ZZZZZZZ${i + 2}`, t.clock.now()));
    const c = await codeFor(dani);
    const r = await t.p.inbound.execute(wa(phone, `VINCULAR ${c.code}`, t.clock.now()));
    assert.match(JSON.stringify(r.response), /muchos códigos seguidos/);
    assert.ok(!(await channelsOf(dani.userId)).includes(`whatsapp:${phone}`));
  });
});

describe("Guía de bienvenida", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let web: Awaited<ReturnType<typeof startWebApi>>;
  type Status = { steps: { id: string; done: boolean; skipped: boolean }[]; pending: number; dismissed: boolean };

  before(async () => {
    t = await testPlatform({ extra: { chatLinks: { whatsappNumber: "+5491150000000" } } });
    web = await startWebApi(t);
  });
  after(() => web.close());

  test("los pasos salen de lo que la persona ya hizo; cerrar la guía no cambia nada más", async () => {
    const eva = await web.login("eva.bienvenida@correo.example");
    const status = async () => (await (await eva("/v1/me/onboarding")).json()) as Status;
    const s0 = await status();
    assert.deepEqual(s0.steps.map((s) => s.id), ["topics", "chat", "notifications", "first_analysis"], "sin organización, no aparece el equipo");
    assert.equal(s0.pending, 4);

    await eva("/v1/me/preferences/follow", post({ topic: "tarifas de gas" }));
    await eva("/v1/analyze", post({ text: "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país." }));
    const c = (await (await eva("/v1/me/channels/link-code", post({}))).json()) as { code: string };
    await t.p.inbound.execute(wa("+5491166660001", `VINCULAR ${c.code}`, t.clock.now()));
    const s1 = await status();
    assert.deepEqual(s1.steps.filter((s) => s.done).map((s) => s.id), ["topics", "chat", "first_analysis"]);

    assert.equal((await eva("/v1/me/onboarding/step", post({ step: "topics", how: "done" }))).status, 400, "los que se deducen no se marcan a mano");
    assert.equal((await eva("/v1/me/onboarding/step", post({ step: "otro", how: "skipped" }))).status, 400);
    const s2 = (await (await eva("/v1/me/onboarding/step", post({ step: "notifications", how: "done" }))).json()) as Status;
    assert.equal(s2.pending, 0);
    assert.equal(s2.dismissed, true, "terminada");
  });

  test("saltear y cerrar; quien administra una organización ve el paso del equipo", async () => {
    const flor = await web.login("flor.bienvenida@correo.example");
    await flor("/v1/organization", post({ name: "Diario Norte" }));
    const s0 = (await (await flor("/v1/me/onboarding")).json()) as Status;
    assert.ok(s0.steps.some((s) => s.id === "team" && !s.done));
    await flor("/v1/organization/invitations", post({ email: "colega@diarionorte.example" }));
    const s1 = (await (await flor("/v1/me/onboarding")).json()) as Status;
    assert.equal(s1.steps.find((s) => s.id === "team")!.done, true, "con una invitación enviada, listo");

    const s2 = (await (await flor("/v1/me/onboarding/step", post({ step: "chat", how: "skipped" }))).json()) as Status;
    assert.equal(s2.steps.find((s) => s.id === "chat")!.skipped, true);
    const s3 = (await (await flor("/v1/me/onboarding/dismiss", post({}))).json()) as Status;
    assert.equal(s3.dismissed, true);
    assert.ok(s3.pending > 0, "cerrada aunque falten pasos");
  });
});

/** 3.8: abuso (límites de frecuencia, captcha, señales, bloqueos) en la web, el chat y la API. */
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { AbuseRejectedError, AccessDeniedError } from "../src/domain/errors";
import type { RateRule } from "../src/domain/model";
import { canonicalEmail, decideAbuse, ipBucket } from "../src/domain/rules/abuse";
import { FakeCaptcha, TurnstileCaptcha } from "../src/infrastructure/abuse/AbuseAdapters";
import { StoreRateLimiter } from "../src/infrastructure/abuse/RateLimiters";
import { clientIp } from "../src/infrastructure/http/clientIp";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { FakeMediaFetcher, FakeSpeechToText } from "../src/infrastructure/inclusion/SpeechAdapters";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

const WEB = { ip: "200.45.1.10", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130" };
const SECRETS = { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" };

async function abusePlatform(extra: { rules?: RateRule[] } = {}) {
  const captcha = new FakeCaptcha("captcha-ok");
  const t = await testPlatform({ extra: { abuse: { captcha, captchaSiteKey: "0xPUBLICA", ...extra } } });
  return { t, captcha };
}

const rejected = (code: string) => (e: unknown) => e instanceof AbuseRejectedError && e.code === code;

describe("Abuso: reglas", () => {
  test("IPv6 se cuenta por red /64 (rotar direcciones no alcanza); IPv4 por dirección", () => {
    assert.equal(ipBucket("2800:40:1a:5::1"), ipBucket("2800:0040:001a:0005:ffff:aaaa:bbbb:cccc"));
    assert.equal(ipBucket("2800:40:1a:5::1"), "2800:40:1a:5::/64");
    assert.notEqual(ipBucket("2800:40:1a:5::1"), ipBucket("2800:40:1a:6::1"));
    assert.equal(ipBucket("::ffff:200.45.1.10"), "200.45.1.10");
  });

  test("un mail es la misma casilla con puntos o etiquetas en Gmail", () => {
    assert.equal(canonicalEmail("Ana.Perez+promo@GMAIL.com"), "anaperez@gmail.com");
    assert.equal(canonicalEmail("ana.perez+x@empresa.com.ar"), "ana.perez@empresa.com.ar");
  });

  test("las señales se combinan por tipo (la más fuerte) y deciden", () => {
    assert.equal(decideAbuse([]).outcome, "allow");
    assert.equal(decideAbuse([{ type: "automation", weight: 60, detail: "x" }, { type: "automation", weight: 40, detail: "y" }]).outcome, "challenge");
    assert.equal(decideAbuse([{ type: "automation", weight: 60, detail: "x" }, { type: "rate_limit", weight: 50, detail: "y" }]).outcome, "deny");
  });

  test("IP real detrás de un proxy: sólo se le cree X-Forwarded-For al proxy de confianza", () => {
    const req = (remote: string, xff?: string) => ({ socket: { remoteAddress: remote }, headers: xff ? { "x-forwarded-for": xff } : {} }) as unknown as IncomingMessage;
    assert.equal(clientIp(req("::ffff:10.0.0.2", "1.2.3.4, 200.45.1.10"), ["10.0.0.0/8"]), "200.45.1.10", "la más a la derecha que no es proxy");
    assert.equal(clientIp(req("200.45.1.10", "1.2.3.4"), ["10.0.0.0/8"]), "200.45.1.10", "no es un proxy: el encabezado se ignora");
    assert.equal(clientIp(req("10.0.0.2", "1.2.3.4"), []), "10.0.0.2", "sin proxies configurados, nunca se lee");
    assert.equal(clientIp(req("10.0.0.2", "8.8.8.8, 10.0.0.9"), ["10.0.0.2", "10.0.0.9"]), "8.8.8.8");
  });
});

describe("Abuso: adaptadores", () => {
  test("límite atómico en la base: con pedidos simultáneos pasan exactamente los permitidos", async () => {
    const t = await testPlatform();
    const limiter = new StoreRateLimiter(t.store.repos.rateCounters);
    const at = new Date("2026-09-28T12:00:30Z");
    const results = await Promise.all(Array.from({ length: 12 }, () => limiter.consume("k", 5, 60, at)));
    assert.equal(results.filter((r) => r.allowed).length, 5);
    assert.equal(results.find((r) => !r.allowed)!.retryAfterSeconds, 30, "hasta que termina la ventana");
    assert.equal((await limiter.consume("k", 5, 60, new Date("2026-09-28T12:01:00Z"))).allowed, true, "ventana nueva");
  });

  test("Turnstile: verifica con el secreto; si el proveedor no responde, no deja pasar", async () => {
    let sent: URLSearchParams | undefined;
    const ok = new TurnstileCaptcha("secreto", async (_u, init) => {
      sent = init?.body as URLSearchParams;
      return new Response(JSON.stringify({ success: sent.get("response") === "bueno" }));
    });
    assert.deepEqual(await ok.verify("bueno", "200.45.1.10"), { ok: true });
    assert.equal(sent!.get("secret"), "secreto");
    assert.equal(sent!.get("remoteip"), "200.45.1.10");
    assert.equal((await ok.verify("malo")).ok, false);
    assert.equal((await ok.verify("")).ok, false);
    const down = new TurnstileCaptcha("s", async () => {
      throw new Error("caído");
    });
    assert.match((await down.verify("x")).error!, /unavailable/);
  });
});

describe("Abuso: alta y acceso por la web", () => {
  test("alta: pide captcha siempre; con captcha pasa; una cuenta existente no lo necesita", async () => {
    const { t } = await abusePlatform();
    await assert.rejects(t.p.auth.requestMagicLink("nueva@ejemplo.com", WEB), rejected("captcha_required"));
    await assert.rejects(t.p.auth.requestMagicLink("nueva@ejemplo.com", { ...WEB, captchaToken: "trucho" }), rejected("captcha_required"));
    await t.p.auth.requestMagicLink("nueva@ejemplo.com", { ...WEB, captchaToken: "captcha-ok" });
    assert.equal(t.mail.sent.filter((m) => m.to === "nueva@ejemplo.com").length, 1);

    await t.p.users.register.execute({ name: "Ya", channel: { type: "email", address: "ya@ejemplo.com", verified: true } });
    await t.p.auth.requestMagicLink("ya@ejemplo.com", WEB);
  });

  test("mails descartables y navegadores automatizados", async () => {
    const { t } = await abusePlatform();
    await assert.rejects(t.p.auth.requestMagicLink("x@mailinator.com", { ...WEB, captchaToken: "captcha-ok" }), rejected("too_many_attempts"));
    await assert.rejects(t.p.auth.requestMagicLink("x@spam.yopmail.com", { ...WEB, captchaToken: "captcha-ok" }), /temporales/);
    await assert.rejects(t.p.auth.loginWithPassword("a@b.com", "x", { ip: WEB.ip, userAgent: "python-requests/2.31" }), rejected("captcha_required"));
    await assert.rejects(t.p.auth.loginWithPassword("a@b.com", "x", { ip: WEB.ip, userAgent: "python-requests/2.31", captchaToken: "captcha-ok" }), (e: unknown) => !(e instanceof AbuseRejectedError));
  });

  test("tope por casilla: no se puede bombardear de mails a nadie; y quien insiste queda bloqueado un rato", async () => {
    const { t } = await abusePlatform();
    const victim = "victima@ejemplo.com";
    // (el cumplimiento del canal ya espacia los mails a una misma casilla: 30 s)
    for (let i = 0; i < 3; i++) {
      await t.p.auth.requestMagicLink(victim, { ...WEB, ip: `200.45.1.${20 + i}`, captchaToken: "captcha-ok" });
      t.clock.advance(31_000);
    }
    const err = await t.p.auth.requestMagicLink(victim, { ...WEB, ip: "200.45.1.99", captchaToken: "captcha-ok" }).catch((e) => e);
    assert.ok(err instanceof AbuseRejectedError && err.code === "too_many_attempts");
    assert.ok(err.retryAfterSeconds! > 0 && err.retryAfterSeconds! <= 3_600);
    assert.equal(t.mail.sent.filter((m) => m.to === victim).length, 3);

    for (let i = 0; i < 5; i++) await t.p.auth.requestMagicLink(victim, { ...WEB, captchaToken: "captcha-ok" }).catch(() => undefined);
    const list = await t.store.repos.restrictions.findActive([{ kind: "email", value: victim }], t.clock.now());
    assert.equal(list.length, 1);
    assert.equal(list[0]!.automatic, true);
    const audit = (await t.store.repos.audit.find({ action: "abuse.restricted" })).length;
    assert.equal(audit, 1);
  });
});

describe("Abuso: chat", () => {
  test("mensajes en ráfaga: se atienden hasta el límite, un solo aviso y después silencio", async () => {
    // (en las pruebas, la espera entre respuestas del canal adelanta el reloj: se usa un límite por hora)
    const { t } = await abusePlatform({ rules: [{ action: "inbound_message", per: "address", limit: 5, windowSeconds: 3_600, onExceed: "deny" }] });
    const from = "+5491177771234";
    for (let i = 0; i < 9; i++) await t.p.abuse.inbound.execute(wa(from, `hola ${i}`, t.clock.now()));
    const out = t.whatsapp.outbox.filter((m) => m.to === from);
    assert.equal(out.filter((m) => /Vas muy rápido/.test(m.text)).length, 1, "un solo aviso");
    assert.equal(out.length, 6, "5 respuestas + 1 aviso; a los otros 3 no se les responde");
    t.clock.advance(3_600_000);
    await t.p.abuse.inbound.execute(wa(from, "hola de nuevo", t.clock.now()));
    assert.equal(t.whatsapp.outbox.filter((m) => m.to === from).length, 7, "en la hora siguiente vuelve a atender");
  });

  test("un número bloqueado: silencio y ni siquiera se crea la cuenta", async () => {
    const { t } = await abusePlatform();
    const agent = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["support_agent"]);
    const from = "+5491100009999";
    const r = await t.p.abuse.admin.restrict({ actorId: agent.id, target: { kind: "address", value: `whatsapp:${from}` }, level: "block", reason: "Spam de ofertas", hours: 24 });
    await t.p.abuse.inbound.execute(wa(from, "compre ya", t.clock.now()));
    assert.equal(t.whatsapp.outbox.filter((m) => m.to === from).length, 0);
    assert.equal(await t.store.repos.users.findByChannel("whatsapp", from), undefined);

    await t.p.abuse.admin.lift({ actorId: agent.id, id: r.id });
    await t.p.abuse.inbound.execute(wa(from, "hola", t.clock.now()));
    assert.ok(await t.store.repos.users.findByChannel("whatsapp", from));

    const reader = await userWithPlan(t, "empresa");
    await assert.rejects(t.p.abuse.admin.list(reader.id), AccessDeniedError);
    await assert.rejects(t.p.abuse.admin.restrict({ actorId: agent.id, target: { kind: "ip", value: "1.2.3.4" }, level: "block", reason: "" }), /motivo/);
  });

  test("funciones con costo: tope por hora", async () => {
    const stt = new FakeSpeechToText();
    const media = new FakeMediaFetcher("whatsapp");
    const rules: RateRule[] = [{ action: "expensive", per: "user", limit: 1, windowSeconds: 3_600, onExceed: "deny" }];
    const t = await testPlatform({ extra: { speech: stt, mediaFetchers: [media], abuse: { rules } } });
    const from = "+5491166665555";
    await t.p.inbound.execute(wa(from, "", t.clock.now(), { audio: { ref: media.voice("Mañana cortan el agua en todo el país") } }));
    t.clock.advance(60_000);
    const r = await t.p.inbound.execute(wa(from, "", t.clock.now(), { audio: { ref: media.voice("Otra cadena para escuchar") } }));
    assert.match(r.response.title, /máximo de audios e imágenes/);
    assert.equal(stt.calls.length, 1);
  });
});

describe("Abuso: API", () => {
  test("429 con Retry-After, captcha con la clave pública y restricciones por HTTP", async () => {
    const rules: RateRule[] = [{ action: "api_request", per: "user", limit: 2, windowSeconds: 60, onExceed: "deny" }, { action: "signup", per: "ip", limit: 100, windowSeconds: 60, onExceed: "deny" }];
    const { t } = await abusePlatform({ rules });
    const u = await userWithPlan(t, "profesional");
    const key = (await t.p.integrations.apiKeys.create({ actorId: u.id, name: "bot", scopes: ["content:analyze"] })).plaintext;
    const server = createHttpApi(httpApiDeps(t.p, { secrets: SECRETS }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      assert.deepEqual(await (await fetch(`${base}/public/captcha`)).json(), { provider: "fake-captcha", siteKey: "0xPUBLICA" });

      const need = await fetch(`${base}/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nueva@ejemplo.com" }) });
      assert.equal(need.status, 403);
      const body = (await need.json()) as { code: string; captcha: { siteKey: string } };
      assert.equal(body.code, "captcha_required");
      assert.equal(body.captcha.siteKey, "0xPUBLICA");
      const ok = await fetch(`${base}/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nueva@ejemplo.com", captchaToken: "captcha-ok" }) });
      assert.equal(ok.status, 200);

      const get = () => fetch(`${base}/v1/evidence`, { headers: { authorization: `Bearer ${key}` } });
      assert.equal((await get()).status, 200);
      assert.equal((await get()).status, 200);
      const limited = await get();
      assert.equal(limited.status, 429);
      assert.ok(Number(limited.headers.get("retry-after")) > 0);
    } finally {
      server.close();
    }
  });
});

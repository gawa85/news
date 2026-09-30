/** Mis fuentes (feeds RSS, buzones IMAP), mis reglas de fuentes y mis réplicas. */
import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import { ValidationError } from "../src/domain/errors";
import type { SourceConnection } from "../src/domain/model";
import { parseFeed, RssFeedSource } from "../src/infrastructure/content/RssSource";
import { PublicDestinationHttpClient } from "../src/infrastructure/integrations/PublicDestinationHttpClient";
import { ImapMailboxSource } from "../src/infrastructure/mail/MailAdapters";
import { htmlToText } from "../src/infrastructure/mail/MailparserMimeParser";
import { StubHttpClient } from "../src/infrastructure/system/EventsAndHttp";
import { testPlatform, userWithPlan, withRoles, type Handler } from "./helpers/platform";

const FEED = `<?xml version="1.0"?><rss><channel><item><title>Nueva suba</title><link>https://diario.example/1</link><pubDate>Mon, 21 Sep 2026 10:00:00 GMT</pubDate><description>Aumento histórico de 12% según la resolución 50.</description></item></channel></rss>`;
const conn = (config: Record<string, string>): SourceConnection => ({ id: "c", userId: "u", type: "rss", name: "x", config, active: true, createdAt: new Date() });

describe("Fuentes: no se pueden usar para llegar a la red interna", () => {
  const dns: Record<string, string[]> = { "diario.example": ["93.184.216.34"], "interno.example": ["10.0.0.9"], "redirige.example": ["93.184.216.35"], "imap.correo.example": ["93.184.216.36"], postgres: ["172.18.0.2"] };
  const resolve = async (h: string) => dns[h] ?? [];

  test("feed RSS: sólo direcciones públicas, también en cada redirección; http se acepta", async () => {
    const inner = new StubHttpClient((_m, url) =>
      url === "http://diario.example/rss" ? { status: 301, headers: { location: "https://diario.example/rss" } }
      : url === "https://diario.example/rss" ? { status: 200, text: FEED }
      : url === "https://redirige.example/rss" ? { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }
      : { status: 200, text: "secreto interno" });
    const rss = new RssFeedSource(new PublicDestinationHttpClient(inner, { allowHttp: true, maxRedirects: 5 }, resolve));
    await rss.test(conn({ url: "http://diario.example/rss" }));
    const pulled = await rss.pull(conn({ url: "http://diario.example/rss" }));
    assert.equal(pulled.items.length, 1);
    for (const url of ["http://interno.example/rss", "https://redirige.example/rss", "http://127.0.0.1/rss", "http://diario.example:5432/rss", "file:///etc/passwd"]) {
      await assert.rejects(rss.test(conn({ url })), (e: unknown) => e instanceof ValidationError || e instanceof TypeError, url);
    }
    assert.ok(!inner.requests.some((r) => /169\.254|interno|127\.0\.0\.1|5432/.test(r.url)), "nunca se llegó a pedir lo interno");
  });

  test("buzón IMAP: sólo puertos de IMAP y servidores públicos (se controla antes de conectar)", async () => {
    const imap = new ImapMailboxSource({ parse: async () => { throw new Error("no se usa"); } }, 50, { resolve });
    const imapConn = (host: string, port = "993") => ({ ...conn({ host, port, user: "ana" }), type: "email" as const });
    await assert.rejects(imap.test(imapConn("postgres")), /no es público/);
    await assert.rejects(imap.test(imapConn("10.0.0.5")), /no es público/);
    await assert.rejects(imap.test(imapConn("imap.correo.example", "5432")), /puerto de IMAP/);
    await assert.rejects(imap.test(imapConn("no-existe.example")), /No existe el servidor/);
  });
});

const feeds: Handler = (_m, url) => (url === "https://feeds.example/rss.xml" ? { status: 200, text: FEED } : { status: 404 });

describe("Lector de feeds: el texto sale limpio", () => {
  test("entidades de XML y de HTML en títulos y textos (como los de A24); el CDATA va tal cual", () => {
    const xml =
      `<rss><channel>` +
      `<item><title>El posteo de Ghione: &quot;El daño no tiene límites&quot;</title><link>https://a.example/1?x=1&amp;y=2</link>` +
      `<description>&lt;p&gt;La inflaci&amp;oacute;n de agosto&lt;/p&gt;</description><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item>` +
      `<item><title><![CDATA[Newell&#039;s y <b>Central</b>]]></title><link>https://a.example/2</link>` +
      `<description><![CDATA[<p>Canci&oacute;n &laquo;nueva&raquo; &Ntilde;u&ntilde;oa</p>]]></description><pubDate>Tue, 29 Sep 2026 11:00:00 GMT</pubDate></item>` +
      `</channel></rss>`;
    const [a, b] = parseFeed(xml);
    assert.equal(a!.title, 'El posteo de Ghione: "El daño no tiene límites"');
    assert.equal(a!.link, "https://a.example/1?x=1&y=2");
    assert.equal(htmlToText(a!.body).trim(), "La inflación de agosto");
    assert.equal(b!.title, "Newell's y Central");
    assert.equal(htmlToText(b!.body).trim(), "Canción «nueva» Ñuñoa");
  });
});

describe("Mis fuentes, reglas y réplicas", () => {
  let t: Awaited<ReturnType<typeof testPlatform>>;
  let deps: ReturnType<typeof httpApiDeps>;
  before(async () => {
    t = await testPlatform({ http: feeds });
    deps = httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "", whatsappAppSecret: "", telegramSecretToken: "", paymentsSecret: "" } });
  });

  test("fuentes: conectar (se prueba antes), listar sin secretos, error visible y desconectar", async () => {
    const u = await userWithPlan(t, "personal");
    const c = await t.p.content.connect.execute({ actorId: u.id, type: "rss", name: "Diario", config: { url: "https://feeds.example/rss.xml" } });
    await assert.rejects(t.p.content.connect.execute({ actorId: u.id, type: "rss", name: "Roto", config: { url: "https://feeds.example/no" } }));
    const list = await deps.sources!.settings.list(u.id);
    assert.equal(list.available, true);
    assert.deepEqual(list.connections.map((x) => x.name), ["Diario"]);
    assert.ok(!("secretRef" in list.connections[0]!) && !("cursor" in list.connections[0]!));

    // Si el feed se cae, queda visible; cuando vuelve, se borra.
    await t.store.repos.sourceConnections.save({ ...(await t.store.repos.sourceConnections.findById(c.id))!, config: { url: "https://feeds.example/caido" } });
    await t.p.content.sync.execute();
    assert.match((await deps.sources!.settings.list(u.id)).connections[0]!.lastError!.message, /404|feed|respond/i);
    await deps.sources!.settings.disconnect({ actorId: u.id, connectionId: c.id });
    assert.equal((await deps.sources!.settings.list(u.id)).connections.length, 0);
    const other = await userWithPlan(t, "personal");
    await assert.rejects(deps.sources!.settings.disconnect({ actorId: other.id, connectionId: c.id }), /No existe/);
  });

  test("reglas: personales; desactivar libera el lugar; las de la organización sólo las cambia quien administra", async () => {
    const u = await userWithPlan(t, "gratis");
    const set = await t.p.users.saveRules.execute({ actorId: u.id, scope: "user", name: "Sin opinión", urlRules: { exclude: ["opinionesya.example"] } });
    await assert.rejects(t.p.users.saveRules.execute({ actorId: u.id, scope: "user", name: "Otra", urlRules: { exclude: ["x.example"] } }), /permite 1/);
    const view = await deps.ruleSets!.settings.list(u.id);
    assert.equal(view.canEditPersonal, true);
    assert.deepEqual(view.personal.map((s) => s.name), ["Sin opinión"]);
    await deps.ruleSets!.settings.deactivate({ actorId: u.id, ruleSetId: set.id });
    assert.ok(await t.p.users.saveRules.execute({ actorId: u.id, scope: "user", name: "Otra", urlRules: { exclude: ["x.example"] } }), "desactivar libera el lugar");
  });

  test("réplicas: el representante ve las de su medio con la resolución", async () => {
    const admin = await withRoles(t, (await userWithPlan(t, "gratis")).id, ["platform_admin"]);
    const rep = await userWithPlan(t, "gratis");
    await t.p.users.assignOutletRepresentative.execute({ actorId: admin.id, targetId: rep.id, outletId: "lvc" });
    const statement = "La nota cita textualmente al secretario de Energía; adjuntamos el audio completo de la conferencia de prensa.";
    const r = await t.p.rebuttals.submit({ actorId: rep.id, outletId: "lvc", target: { type: "credibility", topic: "tarifas de gas" }, statement });
    const mine = await t.p.rebuttals.mine(rep.id);
    assert.deepEqual(mine.map((x) => [x.id, x.status]), [[r.id, "submitted"]]);
    assert.ok(!("submittedBy" in mine[0]!));
    assert.deepEqual(await t.p.rebuttals.mine((await userWithPlan(t, "gratis")).id), []);
  });
});

/** 3.4: redes sociales como fuente. */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { httpApiDeps } from "../src/composition/platform";
import type { IPageCapturer, ISocialSource } from "../src/domain/ports";
import { sharedSocialLink, socialPlatformOf, xStatusId, youtubeVideoId } from "../src/domain/rules/social";
import { createHttpApi } from "../src/infrastructure/http/HttpApi";
import { HttpArticleFetcher } from "../src/infrastructure/news/ArticleFetchers";
import { MemoryTtlCache } from "../src/infrastructure/observability/Observability";
import {
  CachedSocialSource,
  FakeSocialSource,
  FallbackSocialSource,
  OEmbedSocialSource,
  OpenGraphSocialSource,
  YouTubeDataApiSource,
} from "../src/infrastructure/social/SocialSources";
import { StubHttpClient } from "../src/infrastructure/system/EventsAndHttp";
import { ManualClock } from "../src/infrastructure/system/System";
import { testPlatform, userWithPlan, wa, withRoles } from "./helpers/platform";

const u = (s: string) => new URL(s);
const TWEET = "https://x.com/juanp/status/1839999999999999999";
const CHAIN = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario. Es una catástrofe histórica sin precedentes.";

describe("Redes: reglas", () => {
  test("plataforma e ids de cualquier formato de link", () => {
    assert.equal(socialPlatformOf(u("https://www.youtube.com/watch?v=dQw4w9WgXcQ")), "youtube");
    assert.equal(socialPlatformOf(u("https://mobile.twitter.com/a/status/1")), "x");
    assert.equal(socialPlatformOf(u("https://vm.tiktok.com/ZM123/")), "tiktok");
    assert.equal(socialPlatformOf(u("https://t.me/canal/123")), "telegram");
    assert.equal(socialPlatformOf(u("https://www.clarin.com/nota")), "web");
    for (const l of ["https://youtu.be/dQw4w9WgXcQ?t=3", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x", "https://www.youtube.com/embed/dQw4w9WgXcQ"]) {
      assert.equal(youtubeVideoId(u(l)), "dQw4w9WgXcQ", l);
    }
    assert.equal(youtubeVideoId(u("https://www.youtube.com/@canal")), undefined);
    assert.equal(xStatusId(u(TWEET)), "1839999999999999999");
  });

  test("¿el mensaje es un link a una red? (con, a lo sumo, un comentario corto)", () => {
    assert.equal(sharedSocialLink(`Mirá esto, ¿es verdad? ${TWEET}`)?.toString(), TWEET);
    assert.equal(sharedSocialLink(`${CHAIN} ${CHAIN} ${TWEET}`), undefined, "un texto largo se analiza como texto");
    assert.equal(sharedSocialLink(`${TWEET} ${TWEET.replace("999", "888")}`), undefined, "dos links: no se elige uno");
    assert.equal(sharedSocialLink("https://www.clarin.com/politica/nota.html"), undefined, "una nota de un medio no es una red");
  });
});

describe("Redes: lectores", () => {
  test("YouTube (API oficial): título, descripción, canal, fecha y vistas", async () => {
    let asked = "";
    const http = new StubHttpClient((_m, url) => {
      asked = url;
      return { status: 200, text: JSON.stringify({ items: [{ snippet: { title: "Se viene el corte", description: "Mirá lo que dijo el ministro", channelTitle: "Canal X", channelId: "UC1", publishedAt: "2026-09-27T10:00:00Z" }, statistics: { viewCount: "152000", likeCount: "900" } }] }) };
    });
    const yt = new YouTubeDataApiSource(http, "CLAVE");
    assert.equal(yt.canRead(u("https://youtu.be/dQw4w9WgXcQ"), "youtube"), true);
    assert.equal(yt.canRead(u("https://www.youtube.com/@canal"), "youtube"), false);
    const p = await yt.read(u("https://youtu.be/dQw4w9WgXcQ"));
    assert.match(asked, /videos\?part=snippet,statistics&id=dQw4w9WgXcQ&key=CLAVE$/);
    assert.equal(p.text, "Se viene el corte\n\nMirá lo que dijo el ministro");
    assert.equal(p.author!.name, "Canal X");
    assert.equal(p.metrics!.views, 152000);
    assert.equal(p.publishedAt!.toISOString(), "2026-09-27T10:00:00.000Z");
  });

  test("oEmbed de X: texto, usuario y fecha del posteo incrustado; Instagram sólo con token de Meta", async () => {
    const html = `<blockquote class="twitter-tweet"><p lang="es" dir="ltr">Mañana cortan el agua en todo el país &amp; nadie dice nada <a href="https://t.co/x">pic.twitter.com/x</a></p>&mdash; Juan Pérez (@juanp) <a href="${TWEET}?ref_src=twsrc">September 27, 2026</a></blockquote>`;
    const asked: string[] = [];
    const http = new StubHttpClient((_m, url) => {
      asked.push(url);
      return url.includes("tiktok")
        ? { status: 200, text: JSON.stringify({ title: "El dólar a 5000 mañana #economia", author_name: "Finanzas Ya", author_unique_id: "finanzasya" }) }
        : { status: 200, text: JSON.stringify({ author_name: "Juan Pérez", author_url: "https://twitter.com/juanp", html }) };
    });
    const o = new OEmbedSocialSource(http);
    const p = await o.read(u(TWEET), "x");
    assert.match(p.text, /^Mañana cortan el agua en todo el país & nadie dice nada/);
    assert.equal(p.author!.handle, "@juanp");
    assert.equal(p.postId, "1839999999999999999");
    assert.equal(p.publishedAt!.toISOString().slice(0, 10), "2026-09-27");
    assert.match(asked[0]!, /^https:\/\/publish\.twitter\.com\/oembed\?/);
    const tt = await o.read(u("https://www.tiktok.com/@finanzasya/video/123"), "tiktok");
    assert.equal(tt.author!.handle, "@finanzasya");
    assert.equal(tt.text, "El dólar a 5000 mañana #economia");

    assert.equal(o.canRead(u("https://www.instagram.com/p/abc/"), "instagram"), false);
    assert.equal(new OEmbedSocialSource(http, { metaAccessToken: "T" }).canRead(u("https://www.instagram.com/p/abc/"), "instagram"), true);
  });

  test("metadatos públicos (Open Graph) de cualquier link", async () => {
    const page = `<html><head><title>t</title><meta property="og:title" content="Canal Noticias Ya"><meta content="Se confirma el feriado del lunes &amp; el martes" property="og:description"><meta property="og:site_name" content="Telegram"><meta property="article:published_time" content="2026-09-26T08:00:00Z"></head><body>x</body></html>`;
    const capturer: IPageCapturer = { id: "t", capture: async (url) => ({ finalUrl: url, status: 200, mime: "text/html", body: Buffer.from(page), text: "x" }) };
    const p = await new OpenGraphSocialSource(capturer).read(u("https://t.me/canal/123"), "telegram");
    assert.equal(p.text, "Canal Noticias Ya\n\nSe confirma el feriado del lunes & el martes");
    assert.equal(p.author!.name, "Telegram");
    assert.equal(p.publishedAt!.toISOString(), "2026-09-26T08:00:00.000Z");
  });

  test("cadena con respaldo y caché", async () => {
    const failing: ISocialSource = { id: "api", canRead: () => true, read: async () => { throw new Error("cupo agotado"); } };
    const ok = new FakeSocialSource();
    ok.posts.set(TWEET, { platform: "x", url: TWEET, text: "Hola" });
    const chain = new FallbackSocialSource([failing, ok]);
    assert.equal((await chain.read(u(TWEET), "x")).via, "fake-social");
    await assert.rejects(new FallbackSocialSource([failing]).read(u(TWEET), "x"), /api: cupo agotado/);

    const cached = new CachedSocialSource(chain, new MemoryTtlCache(new ManualClock(new Date())));
    await cached.read(u(TWEET), "x");
    await cached.read(u(TWEET), "x");
    assert.equal(ok.reads.length, 2, "una por la cadena de arriba y una sola por la caché");
  });

  test("la descarga de notas de /comparar ahora tiene protección SSRF", async () => {
    const t = await testPlatform();
    const f = new HttpArticleFetcher(t.store.repos.outlets, { next: () => "a1" });
    await assert.rejects(f.fetch("http://169.254.169.254/latest/meta-data/", "x"), /no es una página pública/);
    await assert.rejects(f.fetch("file:///etc/passwd", "x"), /http o https/);
  });
});

describe("Redes: en el chat y la API", () => {
  async function socialPlatform() {
    const src = new FakeSocialSource();
    src.posts.set(TWEET, { platform: "x", url: TWEET, text: CHAIN, author: { name: "Juan Pérez", handle: "@juanp" }, publishedAt: new Date("2026-09-27T12:00:00Z"), metrics: { views: 15000 } });
    const t = await testPlatform({ extra: { social: { sources: [src] } } });
    return { t, src };
  }

  test("un link a un posteo: se analiza lo que dice, y se muestra qué se leyó", async () => {
    const { t } = await socialPlatform();
    const r = await t.p.inbound.execute(wa("+5491122223333", `¿Es verdad esto? ${TWEET}`, t.clock.now()));
    assert.equal(r.response.sections[0]!.heading, "📱 Publicación en X (Twitter)");
    assert.equal(r.response.sections[0]!.lines[0], "Juan Pérez @juanp · 27/09/2026 · 15.000 vistas");
    assert.equal(r.response.kind, "result");
    const [saved] = await t.store.repos.contentAnalyses.findByUser(r.user.id, 1);
    assert.equal(saved!.item.sourceType, "social");
    assert.equal(saved!.item.text, CHAIN);
    assert.equal(saved!.item.origin.address, "@juanp");
    assert.equal(saved!.item.metadata.platform, "x");
    assert.ok(saved!.smoke.smokeIndex > 0, "se encontró el humo del posteo");
  });

  test("si no se puede leer, se analiza el mensaje y se avisa; apagado de emergencia", async () => {
    const { t, src } = await socialPlatform();
    src.failWith = "borrado";
    const r = await t.p.inbound.execute(wa("+5491122224444", `mirá ${TWEET}`, t.clock.now()));
    assert.equal(r.response.sections[0]!.heading, "📱 No pude leer la publicación");

    const { t: t2, src: s2 } = await socialPlatform();
    const a = await withRoles(t2, (await userWithPlan(t2, "gratis")).id, ["platform_admin"]);
    await t2.p.flags.update({ actorId: a.id, key: "social_links", enabled: false });
    await t2.p.inbound.execute(wa("+5491122225555", TWEET, t2.clock.now()));
    assert.equal(s2.reads.length, 0);
  });

  test("API: POST /v1/social/read", async () => {
    const { t } = await socialPlatform();
    const pro = await userWithPlan(t, "profesional");
    const key = (await t.p.integrations.apiKeys.create({ actorId: pro.id, name: "bot", scopes: ["content:analyze"] })).plaintext;
    const server = createHttpApi(httpApiDeps(t.p, { secrets: { whatsappVerifyToken: "v", whatsappAppSecret: "s", telegramSecretToken: "t", paymentsSecret: "p" } }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (url: string) => fetch(`${base}/v1/social/read`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ url }) });
    try {
      const ok = await post(TWEET);
      assert.equal(ok.status, 200);
      assert.equal(((await ok.json()) as { author: { handle: string } }).author.handle, "@juanp");
      assert.equal((await post("no es un link")).status, 400);
    } finally {
      server.close();
    }
  });
});

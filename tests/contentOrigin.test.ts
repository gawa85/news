/** De dónde vino cada análisis, dicho en castellano. */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ContentItem } from "../src/domain/model";
import { originOf } from "../src/domain/rules/contentOrigin";

const item = (over: Partial<ContentItem>): ContentItem => ({
  id: "i", sourceType: "message", origin: {}, text: "hola", urls: [], publishedAt: new Date(), receivedAt: new Date(), attachments: [], metadata: {}, ...over,
});

describe("Origen de un análisis", () => {
  test("cada forma de llegar, con su descripción", () => {
    const cases: [ContentItem, string | undefined, string][] = [
      [item({ sourceType: "rss", origin: { name: "Clarín", domain: "clarin.com" }, urls: ["https://clarin.com/nota"] }), "Mis diarios", "Feed «Mis diarios» (clarin.com)"],
      [item({ sourceType: "email", connectionId: "c1", origin: { name: "Ana", address: "ana@correo.example", domain: "correo.example" } }), "Mi Gmail", "Buzón «Mi Gmail»: mail de Ana <ana@correo.example>"],
      [item({ sourceType: "email", origin: { address: "x@y.example" }, forwardedFrom: {} }), undefined, "Mail de x@y.example, reenviado"],
      [item({ metadata: { channel: "whatsapp", "forwarded-many-times": "true" }, origin: { address: "+5491100000000" }, forwardedFrom: {} }), undefined, "WhatsApp, reenviado muchas veces"],
      [item({ metadata: { channel: "telegram", "extracted-from": "voice" } }), undefined, "Telegram, texto sacado de un audio"],
      [item({}), undefined, "Texto pegado en la web"],
      [item({ sourceType: "web", origin: { address: "https://sitio.example/n", domain: "sitio.example" } }), undefined, "Link a sitio.example"],
      [item({ sourceType: "social", metadata: { platform: "x" }, origin: { name: "Juan", address: "@juan", domain: "x.com" }, urls: ["https://x.com/juan/status/1"] }), undefined, "Publicación en X (Twitter) de Juan <@juan>"],
    ];
    for (const [it, name, label] of cases) assert.equal(originOf(it, name).label, label);
  });

  test("el link al original; el número de quien escribe por WhatsApp (la propia persona) no se muestra", () => {
    assert.equal(originOf(item({ sourceType: "rss", urls: ["https://clarin.com/nota"] })).url, "https://clarin.com/nota");
    const wa = originOf(item({ metadata: { channel: "whatsapp" }, origin: { address: "+5491100000000", name: "Eva" } }));
    assert.equal(wa.author, undefined);
    assert.ok(!JSON.stringify(wa).includes("5491100000000"));
  });
});

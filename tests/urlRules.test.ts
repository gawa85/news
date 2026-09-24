import assert from "node:assert/strict";
import { test } from "node:test";
import { passesUrlRules, urlMatches } from "../src/domain/model";

test("un dominio coincide con sus subdominios y cualquier ruta", () => {
  assert.equal(urlMatches("https://www.diario.example/nota/1", "diario.example"), true);
  assert.equal(urlMatches("https://m.diario.example/nota/1", "diario.example"), true);
  assert.equal(urlMatches("https://otrodiario.example/nota/1", "diario.example"), false);
});

test("un dominio con ruta sólo coincide con esa sección", () => {
  assert.equal(urlMatches("https://diario.example/opinion/columna", "diario.example/opinion"), true);
  assert.equal(urlMatches("https://diario.example/opinionesX", "diario.example/opinion"), false);
  assert.equal(urlMatches("https://diario.example/economia/nota", "diario.example/opinion"), false);
});

test("exclude gana sobre onlyFrom", () => {
  const rules = { onlyFrom: ["diario.example"], exclude: ["diario.example/opinion"] };
  assert.equal(passesUrlRules("https://diario.example/economia/1", rules), true);
  assert.equal(passesUrlRules("https://diario.example/opinion/1", rules), false);
  assert.equal(passesUrlRules("https://otro.example/economia/1", rules), false);
});

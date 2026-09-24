/**
 * TEST DE ARQUITECTURA: hace cumplir la regla de dependencias (DIP) automáticamente.
 *   dominio      → no importa nada de aplicación, infraestructura ni composición
 *   aplicación   → no importa infraestructura ni composición (sólo el dominio)
 *   infraestructura → no importa composición
 * Si alguien rompe la regla, este test falla y dice dónde.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = join(__dirname, "..", "..", "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

function violations(layer: string, forbidden: string[]): string[] {
  return files(join(ROOT, layer)).flatMap((file) => {
    const src = readFileSync(file, "utf8");
    const imports = [...src.matchAll(/(?:import|export)[^;]*?from\s+"([^"]+)"|import\("([^"]+)"\)/g)].map((m) => m[1] ?? m[2]!);
    return imports
      .filter((i) => i.startsWith("."))
      .filter((i) => forbidden.some((f) => new RegExp(`(^|/)${f}(/|$)`).test(i)))
      .map((i) => `${relative(ROOT, file)} importa ${i}`);
  });
}

test("el dominio no depende de nada de afuera", () => {
  assert.deepEqual(violations("domain", ["application", "infrastructure", "composition", "entry", "config"]), []);
});

test("la aplicación sólo depende del dominio (nunca de infraestructura)", () => {
  assert.deepEqual(violations("application", ["infrastructure", "composition", "entry"]), []);
});

test("la infraestructura no depende de la composición", () => {
  assert.deepEqual(violations("infrastructure", ["composition", "entry"]), []);
});

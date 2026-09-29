// Después de correr las pruebas: cada archivo dist/tests/*.test.js tiene que haber informado
// resultados. Si alguno no aparece, la corrida falla (nunca más pruebas perdidas en silencio).
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const report = process.argv[2] ?? "dist/test-files.json";
const expected = readdirSync("dist/tests").filter((f) => f.endsWith(".test.js")).sort();
const seen = new Set(JSON.parse(readFileSync(report, "utf8")).map((f) => basename(f)));
const missing = expected.filter((f) => !seen.has(f));
if (missing.length) {
  console.error(`\nFALTAN RESULTADOS de ${missing.length} archivo(s) de prueba (no corrieron o no informaron):\n  - ${missing.join("\n  - ")}\n`);
  process.exit(1);
}
console.log(`Control: los ${expected.length} archivos de prueba informaron resultados.`);

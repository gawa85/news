// Después de correr las pruebas:
//  - cada archivo dist/tests/*.test.js tiene que haber informado resultados;
//  - cada prueba que se encoló tiene que haber terminado (pasado o fallado).
// Si algo falta, la corrida falla y dice qué (nunca más pruebas perdidas en silencio).
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const report = JSON.parse(readFileSync(process.argv[2] ?? "dist/test-files.json", "utf8"));
const expected = readdirSync("dist/tests").filter((f) => f.endsWith(".test.js")).sort();
const seen = new Set(report.files.map((f) => basename(f)));
const missing = expected.filter((f) => !seen.has(f));
let ok = true;
if (missing.length) {
  console.error(`\nFALTAN RESULTADOS de ${missing.length} archivo(s) de prueba (no corrieron o no informaron):\n  - ${missing.join("\n  - ")}\n`);
  ok = false;
}
if (report.unfinished.length) {
  console.error(`\n${report.unfinished.length} prueba(s) empezaron y nunca terminaron:\n  - ${report.unfinished.join("\n  - ")}\n`);
  ok = false;
}
if (!ok) process.exit(1);
console.log(`Control: los ${expected.length} archivos informaron resultados y ninguna prueba quedó sin terminar.`);

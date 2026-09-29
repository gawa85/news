// Reporter adicional de node:test: anota qué archivos informaron resultados y qué pruebas se
// encolaron sin terminar (ni pasaron ni fallaron). Lo revisa check-files.mjs al final.
export default async function* filesReporter(source) {
  const seen = new Set();
  const pending = new Map();
  const key = (d) => `${d.file ?? "?"}:${d.line ?? "?"}:${d.column ?? "?"} ${d.name}`;
  for await (const event of source) {
    const d = event.data;
    // (el nivel 0 de cada archivo lo cubre `seen`: al terminar no trae la misma posición)
    if (event.type === "test:enqueue" && !(d.nesting === 0 && d.file?.endsWith(d.name))) pending.set(key(d), d.name);
    if (event.type === "test:pass" || event.type === "test:fail") {
      pending.delete(key(d));
      if (d.file) seen.add(d.file);
    }
  }
  yield JSON.stringify({ files: [...seen].sort(), unfinished: [...pending.keys()].sort() });
}

// Reporter adicional de node:test: anota qué archivos de prueba informaron resultados.
// Lo usa check-files.mjs para detectar un archivo que no llegó a correr (antes se perdían
// pruebas en silencio en algunas corridas con mucha carga: el total bajaba sin ninguna falla).
export default async function* filesReporter(source) {
  const seen = new Set();
  for await (const event of source) {
    if ((event.type === "test:pass" || event.type === "test:fail") && event.data?.file) seen.add(event.data.file);
  }
  yield JSON.stringify([...seen].sort());
}

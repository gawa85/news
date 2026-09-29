import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { CsvKind, ImportReport } from "../../api/backofficeTypes";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { isoDay } from "../shared/catalog";

const MAX_CSV_BYTES = 900_000;

const CSV_KINDS: Record<CsvKind, { label: string; columns: string; sample: string }> = {
  outlets: {
    label: "Medios",
    columns: "id, nombre, url, tipo, pais, provincia, localidad, rss, alias (separados por |)",
    sample: "id,nombre,url,tipo,pais,provincia,localidad,rss,alias\ndiario-sur,Diario Sur,https://diariosur.com.ar,digital,AR,Chubut,Trelew,https://diariosur.com.ar/rss,El Sur|DS\nradio-norte,Radio Norte,https://radionorte.com.ar,radio,AR,Salta,,,\n",
  },
  ownership: {
    label: "Propiedad",
    columns: "medio (id o nombre), dueno, sectores (separados por |), desde, hasta, fuente",
    sample: "medio,dueno,sectores,desde,hasta,fuente\ndiario-sur,Grupo Patagonia S.A.,energía|construcción,2015-03-01,,Boletín Oficial 12/03/2015\n",
  },
  advertising: {
    label: "Pauta oficial",
    columns: "medio (id o nombre), pagador, jurisdiccion (nacional, provincial o municipal), monto, moneda, desde, hasta",
    sample: "medio,pagador,jurisdiccion,monto,moneda,desde,hasta\nDiario Sur,Gobierno de Chubut,provincial,1500000,ARS,2026-01-01,2026-03-31\n",
  },
};

// ---------------- Catálogo de medios ----------------

/** IMPORTAR EL CATÁLOGO: medios, dueños, pauta y feeds desde fuentes públicas o un CSV propio. Cada dato guarda su fuente. */
export function CatalogPage() {
  const api = useBackoffice();
  const sources = useAsync(() => api.catalogSources(), [api]);
  const run = useAction(async (sourceId: string) => api.importCatalog(sourceId));
  return (
    <Page title="Catálogo de medios" lead="Importar vuelve a escribir los datos de cada medio con los de la fuente; lo que no se reconoce queda en el informe.">
      {sources.loading && !sources.data && <Spinner />}
      <ErrorAlert error={sources.error} />
      {sources.data && (
        <>
          <section className="card stack" aria-labelledby="fuentes-configuradas">
            <h2 id="fuentes-configuradas">Fuentes configuradas</h2>
            {sources.data.sources.length === 0 ? (
              <p className="muted">No hay fuentes de datos abiertos configuradas en el servidor. Podés subir un CSV.</p>
            ) : (
              <ul className="plain-list stack">
                {sources.data.sources.map((s) => (
                  <li key={s.id} className="row" style={{ justifyContent: "space-between" }}>
                    <span>{s.label}</span>
                    <button className="btn btn--small" type="button" aria-label={`Importar ${s.label}`} disabled={run.pending} onClick={() => void run.run(s.id)}>
                      Importar
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <ErrorAlert error={run.error} />
            {run.result && <ReportView r={run.result} />}
          </section>
          {sources.data.csvUpload && <CsvUpload />}
        </>
      )}
    </Page>
  );
}

function CsvUpload() {
  const api = useBackoffice();
  const [kind, setKind] = useState<CsvKind>("outlets");
  const [file, setFile] = useState<File>();
  const [tooBig, setTooBig] = useState(false);
  const upload = useAction(async () => api.importCsv(kind, await file!.text()));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file && !tooBig) void upload.run();
  };
  return (
    <section className="card stack" aria-labelledby="subir-csv">
      <h2 id="subir-csv">Subir un CSV</h2>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="grid-2">
          <Field label="Qué contiene">
            {(p) => (
              <select {...p} className="input" value={kind} onChange={(e) => setKind(e.target.value as CsvKind)}>
                {(Object.keys(CSV_KINDS) as CsvKind[]).map((k) => (
                  <option key={k} value={k}>
                    {CSV_KINDS[k].label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Archivo CSV"
            hint={
              <>
                Columnas: {CSV_KINDS[kind].columns}. Se arma en Excel o Google Sheets y se descarga como CSV.{" "}
                <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(CSV_KINDS[kind].sample)}`} download={`ejemplo-${kind}.csv`}>
                  Descargar un ejemplo de {CSV_KINDS[kind].label.toLowerCase()}
                </a>
              </>
            } error={tooBig ? "El archivo es demasiado grande (máximo 900 kB): dividilo en partes." : undefined}>
            {(p) => (
              <input
                {...p}
                className="input"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setFile(f);
                  setTooBig(!!f && f.size > MAX_CSV_BYTES);
                  upload.reset();
                }}
              />
            )}
          </Field>
        </div>
        <div className="row">
          <button className="btn btn--small" type="submit" disabled={upload.pending || !file || tooBig}>
            {upload.pending ? "Importando…" : "Importar CSV"}
          </button>
        </div>
      </form>
      <ErrorAlert error={upload.error} />
      {upload.result && <ReportView r={upload.result} />}
    </section>
  );
}

function ReportView({ r }: { r: ImportReport }) {
  const loaded = [
    [r.outlets, "medios"],
    [r.feeds, "feeds"],
    [r.owners, "dueños"],
    [r.ownership, "registros de propiedad"],
    [r.advertising, "registros de pauta"],
  ].filter(([n]) => (n as number) > 0);
  return (
    <div className="stack" role="status">
      <Notice tone="ok" title="Importación terminada">
        <p>{loaded.length ? `Se cargaron ${loaded.map(([n, what]) => `${n} ${what}`).join(", ")}.` : "No se cargó ningún dato."}</p>
      </Notice>
      <Issues title="No se reconocieron" items={r.unmatched} />
      <Issues title="Rechazados" items={r.rejected} />
      <Issues title="Para revisar" items={r.warnings} />
    </div>
  );
}

function Issues({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <details>
      <summary>
        {title} ({items.length})
      </summary>
      <ul>
        {items.slice(0, 100).map((x, i) => (
          <li key={i} style={{ wordBreak: "break-word" }}>
            {x}
          </li>
        ))}
      </ul>
      {items.length > 100 && <p className="muted">Y {items.length - 100} más.</p>}
    </details>
  );
}

// ---------------- Documentos oficiales ----------------

/** DOCUMENTOS OFICIALES: resoluciones e informes que la búsqueda de evidencia encuentra al verificar. */
export function DocumentsPage() {
  const api = useBackoffice();
  const [title, setTitle] = useState("");
  const [issuer, setIssuer] = useState("");
  const [url, setUrl] = useState("");
  const [publishedAt, setPublishedAt] = useState(isoDay(0));
  const [topics, setTopics] = useState("");
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const save = useAction(async () => {
    const doc = await api.uploadDocument({
      title: title.trim(), issuer: issuer.trim(), url: url.trim(), publishedAt: new Date(`${publishedAt}T12:00:00-03:00`).toISOString(), text: text.trim(),
      topics: topics.split(",").map((x) => x.trim()).filter(Boolean),
    });
    setTitle("");
    setUrl("");
    setText("");
    setTopics("");
    setTried(false);
    return doc;
  });
  const urlOk = /^https?:\/\/\S+$/.test(url.trim());
  const ready = title.trim() && issuer.trim() && urlOk && text.trim() && publishedAt;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (ready) void save.run();
  };
  return (
    <Page title="Documentos oficiales" lead="Lo que cargues acá aparece como evidencia sugerida en las tareas de verificación.">
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="grid-2">
          <Field label="Título" error={tried && !title.trim() ? "Falta el título." : undefined}>
            {(p) => <input {...p} className="input" value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Quién lo emitió" hint="Por ejemplo: ENARGAS, INDEC, Ministerio de Economía." error={tried && !issuer.trim() ? "Falta quién lo emitió." : undefined}>
            {(p) => <input {...p} className="input" value={issuer} onChange={(e) => setIssuer(e.target.value)} />}
          </Field>
          <Field label="URL oficial" hint="De dónde se obtuvo (Boletín Oficial, sitio del organismo)." error={tried && !urlOk ? "Poné la URL completa (https://…)." : undefined}>
            {(p) => <input {...p} className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />}
          </Field>
          <Field label="Fecha de publicación">{(p) => <input {...p} className="input" type="date" value={publishedAt} max={isoDay(0)} onChange={(e) => setPublishedAt(e.target.value)} />}</Field>
          <Field label="Temas" hint="Separados por coma (ayudan a encontrarlo).">
            {(p) => <input {...p} className="input" value={topics} onChange={(e) => setTopics(e.target.value)} />}
          </Field>
        </div>
        <Field label="Texto del documento" hint="Pegá el texto completo o la parte relevante (con las cifras)." error={tried && !text.trim() ? "Falta el texto." : undefined}>
          {(p) => <textarea {...p} className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="row">
          <button className="btn btn--small" type="submit" disabled={save.pending}>
            Cargar documento
          </button>
        </div>
        <ErrorAlert error={save.error} />
        {save.result && (
          <Notice tone="ok">
            <p>Documento cargado: «{save.result.title}».</p>
          </Notice>
        )}
      </form>
    </Page>
  );
}

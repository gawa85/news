import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiContext";
import { useBackoffice } from "../../api/BackofficeContext";
import type { AdminOutlet, OutletDraft, OutletFeed, OutletKind, OutletRecord } from "../../api/backofficeTypes";
import { formatDate, formatDateTime, OUTLET_KIND_LABELS } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { DirectoryPicker } from "../shared/DirectoryPicker";

const KINDS = Object.keys(OUTLET_KIND_LABELS) as OutletKind[];
const words = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const isWeb = (s: string) => /^https?:\/\/\S+\.\S+/.test(s.trim());

/** MEDIOS: corregir los datos de un medio, sumar uno nuevo y manejar sus feeds. La propiedad y la pauta se ven (se cargan importando). */
export function OutletsAdminPage() {
  const api = useApi();
  const all = useAsync(() => api.outlets(), [api]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const needle = q.trim().toLowerCase();
  const matches = (all.data ?? [])
    .filter((o) => !needle || `${o.name} ${o.id} ${o.url}`.toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 50);
  const created = (o: AdminOutlet) => {
    setCreating(false);
    void all.reload();
    setSelected(o.id);
  };
  return (
    <Page title="Medios" lead="El id de un medio no cambia: lo usan sus notas, veredictos y réplicas.">
      <div className="row">
        <button className="btn btn--small" type="button" aria-expanded={creating} onClick={() => setCreating(!creating)}>
          {creating ? "Cancelar" : "Nuevo medio"}
        </button>
      </div>
      {creating && (
        <section className="card stack" aria-labelledby="nuevo-medio">
          <h2 id="nuevo-medio">Nuevo medio</h2>
          <OutletForm onSaved={created} />
        </section>
      )}
      <KnownOutlets onImported={() => void all.reload()} />
      <ReadAllFeeds />
      <section className="card stack" aria-labelledby="buscar-medio">
        <h2 id="buscar-medio">Buscar</h2>
        <Field label="Nombre, id o sitio del medio">{(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        {all.loading && !all.data && <Spinner />}
        <ErrorAlert error={all.error} />
        {all.data && matches.length === 0 && <p className="muted">Ningún medio coincide.</p>}
        <ul className="plain-list stack">
          {matches.map((o) => (
            <li key={o.id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <span style={{ wordBreak: "break-word" }}>
                {o.name} <span className="muted">{o.url}</span>
              </span>
              <button className="btn btn--ghost btn--small" type="button" aria-label={`Editar ${o.name}`} aria-pressed={selected === o.id} onClick={() => setSelected(o.id)}>
                Editar
              </button>
            </li>
          ))}
        </ul>
      </section>
      {selected && <OutletEditorCard key={selected} id={selected} onSaved={() => void all.reload()} />}
    </Page>
  );
}

function OutletEditorCard({ id, onSaved }: { id: string; onSaved: () => void }) {
  const bo = useBackoffice();
  const rec = useAsync(() => bo.outletRecord(id), [bo, id]);
  const r = rec.data;
  return (
    <section className="card stack" aria-labelledby="medio-elegido">
      <h2 id="medio-elegido">{r ? r.outlet.name : "Medio"}</h2>
      {rec.loading && !r && <Spinner />}
      <ErrorAlert error={rec.error} />
      {r && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Id: <span className="mono">{r.outlet.id}</span>
          </p>
          <OutletForm
            outlet={r.outlet}
            onSaved={(o) => {
              rec.setData({ ...r, outlet: o });
              onSaved();
            }}
          />
          <FeedsSection record={r} onChange={(feeds) => rec.setData({ ...r, feeds })} />
          <div className="stack">
            <h3 style={{ margin: 0 }}>Propiedad</h3>
            {r.ownership.length === 0 ? (
              <p className="muted">Sin datos de propiedad. Se cargan importando (Importar catálogo), cada uno con su fuente.</p>
            ) : (
              <ul>
                {r.ownership.map((o) => (
                  <li key={`${o.ownerId}:${o.since}`}>
                    {o.ownerName}: desde {formatDate(o.since)}
                    {o.until ? ` hasta ${formatDate(o.until)}` : ""} <span className="muted">(fuente: {o.source})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function OutletForm({ outlet, onSaved }: { outlet?: AdminOutlet; onSaved: (o: AdminOutlet) => void }) {
  const bo = useBackoffice();
  const [name, setName] = useState(outlet?.name ?? "");
  const [url, setUrl] = useState(outlet?.url ?? "https://");
  const [kind, setKind] = useState<OutletKind>(outlet?.kind ?? "digital");
  const [country, setCountry] = useState(outlet?.region.country ?? "AR");
  const [province, setProvince] = useState(outlet?.region.province ?? "");
  const [locality, setLocality] = useState(outlet?.region.locality ?? "");
  const [aliases, setAliases] = useState(outlet?.aliases?.join(", ") ?? "");
  const [tried, setTried] = useState(false);
  const save = useAction(async (draft: OutletDraft) => {
    const o = await bo.saveOutlet(draft);
    onSaved(o);
    return o;
  });
  const countryOk = /^[A-Za-z]{2}$/.test(country.trim());
  const ready = name.trim() && isWeb(url) && countryOk;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!ready) return;
    void save.run({
      id: outlet?.id,
      name: name.trim(),
      url: url.trim(),
      kind,
      region: { country: country.trim().toUpperCase(), province: province.trim() || undefined, locality: locality.trim() || undefined },
      aliases: words(aliases),
    });
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="grid-2">
        <Field label="Nombre" error={tried && !name.trim() ? "Falta el nombre." : undefined}>
          {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Sitio" error={tried && !isWeb(url) ? "Poné la dirección completa (https://…)." : undefined}>
          {(p) => <input {...p} className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />}
        </Field>
        <Field label="Tipo">
          {(p) => (
            <select {...p} className="input" value={kind} onChange={(e) => setKind(e.target.value as OutletKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {OUTLET_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="País" hint="Código de dos letras (AR, UY…)." error={tried && !countryOk ? "Código de dos letras." : undefined}>
          {(p) => <input {...p} className="input" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />}
        </Field>
        <Field label="Provincia (opcional)">{(p) => <input {...p} className="input" value={province} onChange={(e) => setProvince(e.target.value)} />}</Field>
        <Field label="Localidad (opcional)">{(p) => <input {...p} className="input" value={locality} onChange={(e) => setLocality(e.target.value)} />}</Field>
        <Field label="Otros nombres" hint="Como aparece en datasets de pauta o propiedad (separados por coma).">
          {(p) => <input {...p} className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} />}
        </Field>
      </div>
      <div className="row">
        <button className="btn btn--small" type="submit" disabled={save.pending}>
          {outlet ? "Guardar cambios" : "Crear medio"}
        </button>
      </div>
      <ErrorAlert error={save.error} />
      {save.result && outlet && (
        <Notice tone="ok">
          <p>Cambios guardados.</p>
        </Notice>
      )}
    </form>
  );
}

function FeedsSection({ record, onChange }: { record: OutletRecord; onChange: (feeds: OutletFeed[]) => void }) {
  const bo = useBackoffice();
  const [url, setUrl] = useState("");
  const id = record.outlet.id;
  const add = useAction(async () => {
    const f = await bo.addOutletFeed(id, url.trim());
    onChange([...record.feeds.filter((x) => x.id !== f.id), f]);
    setUrl("");
  });
  const toggle = useAction(async (f: OutletFeed) => {
    const next = await bo.setOutletFeedActive(id, f.id, !f.active);
    onChange(record.feeds.map((x) => (x.id === next.id ? next : x)));
  });
  const [readResult, setReadResult] = useState<{ url: string; articles: number; error?: string }>();
  const read = useAction(async (f: OutletFeed) => {
    const r = await bo.readOutletFeed(id, f.id);
    onChange(record.feeds.map((x) => (x.id === r.feed.id ? r.feed : x)));
    setReadResult({ url: f.url, articles: r.articles, error: r.error });
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (isWeb(url)) void add.run();
  };
  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>Feeds de noticias</h3>
      <p className="muted" style={{ margin: 0 }}>
        De acá salen las notas del medio. Un feed no se borra: se desactiva.
      </p>
      {record.feeds.length === 0 ? (
        <p className="muted">Sin feeds.</p>
      ) : (
        <ul className="plain-list stack">
          {record.feeds.map((f) => (
            <li key={f.id} className="stack" style={{ gap: "0.25rem" }}>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <span style={{ wordBreak: "break-all" }}>
                  {f.url} {f.active ? <span className="badge badge--fact">Activo</span> : <span className="badge badge--neutral">Desactivado</span>}
                </span>
                <span className="row">
                  {f.active && (
                    <button className="btn btn--ghost btn--small" type="button" aria-label={`Leer ahora el feed ${f.url}`} disabled={read.pending} onClick={() => void read.run(f)}>
                      {read.pending ? "Leyendo…" : "Leer ahora"}
                    </button>
                  )}
                  <button className="btn btn--ghost btn--small" type="button" aria-label={`${f.active ? "Desactivar" : "Activar"} el feed ${f.url}`} disabled={toggle.pending} onClick={() => void toggle.run(f)}>
                    {f.active ? "Desactivar" : "Activar"}
                  </button>
                </span>
              </div>
              {(f.lastFetchedAt || f.lastError) && (
                <span className="muted">
                  {f.lastFetchedAt && `Última lectura: ${formatDateTime(f.lastFetchedAt)}.`} {f.lastError && `Último error: ${f.lastError}.`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="row" style={{ alignItems: "flex-end", flexWrap: "wrap" }} onSubmit={submit} noValidate>
        <Field label="Dirección de un feed nuevo (RSS o Atom)">{(p) => <input {...p} className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
        <button className="btn btn--small" type="submit" disabled={add.pending || !isWeb(url)}>
          Agregar feed
        </button>
      </form>
      <ErrorAlert error={add.error ?? toggle.error ?? read.error} />
      {readResult && (
        <p role="status" style={{ margin: 0 }}>
          {readResult.error ? `No se pudo leer ${readResult.url}: ${readResult.error}` : readResult.articles ? `Listo: ${readResult.articles} nota(s) nueva(s).` : "Listo: no había notas nuevas."}
        </p>
      )}
    </div>
  );
}

/** MEDIOS CONOCIDOS: cargar de una vez medios del directorio con su feed (y volver a verificar los feeds). */
function KnownOutlets({ onImported }: { onImported: () => void }) {
  const bo = useBackoffice();
  const dir = useAsync(() => bo.catalogDirectory(), [bo]);
  const [pickerKey, setPickerKey] = useState(0);
  const load = useAction(async (ids: string[]) => {
    const r = await bo.importDirectory(ids);
    await dir.reload();
    setPickerKey((k) => k + 1);
    onImported();
    return r;
  });
  const verify = useAction(() => bo.verifyDirectory());
  const broken = verify.result?.filter((c) => !c.ok) ?? [];
  return (
    <details className="card">
      <summary>
        <strong>Agregar medios conocidos</strong> <span className="muted">(con su feed ya comprobado)</span>
      </summary>
      <div className="stack">
        {dir.loading && !dir.data && <Spinner />}
        <ErrorAlert error={dir.error} />
        {dir.data && (
          <DirectoryPicker
            key={pickerKey}
            entries={dir.data}
            isAdded={(e) => !!dir.data!.find((x) => x.id === e.id)?.feedActive}
            addedLabel="En el catálogo"
            room={null}
            submitLabel="Cargar en el catálogo"
            pending={load.pending}
            onSubmit={(ids) => void load.run(ids)}
          />
        )}
        <ErrorAlert error={load.error} />
        {load.result && (
          <Notice tone="ok">
            <p>
              Listo: {load.result.outlets} medio(s) nuevo(s) y {load.result.feeds} feed(s) activado(s). Las notas empiezan a entrar en la próxima lectura (cada 30 minutos).
            </p>
          </Notice>
        )}
        <div className="row">
          <button className="btn btn--ghost btn--small" type="button" disabled={verify.pending} onClick={() => void verify.run()}>
            {verify.pending ? "Verificando…" : "Volver a verificar los feeds del directorio"}
          </button>
        </div>
        <ErrorAlert error={verify.error} />
        {verify.result && (
          <div role="status">
            {broken.length === 0 ? (
              <Notice tone="ok">
                <p>Los {verify.result.length} feeds responden y traen notas.</p>
              </Notice>
            ) : (
              <Notice title={`${broken.length} de ${verify.result.length} no responden`}>
                <p>Puede ser momentáneo. Si sigue, avisá para actualizar el directorio.</p>
                <ul>
                  {broken.map((c) => (
                    <li key={c.id}>
                      {c.name}: {c.error}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

/** Leer todos los feeds del catálogo ya (va a la cola: no hay que esperar en la pantalla). */
function ReadAllFeeds() {
  const bo = useBackoffice();
  const run = useAction(() => bo.readAllFeeds());
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn btn--secondary btn--small" type="button" disabled={run.pending} onClick={() => void run.run()}>
          Leer todos los feeds ahora
        </button>
        <span className="muted">Solos se leen cada 30 minutos.</span>
      </div>
      <ErrorAlert error={run.error} />
      {run.result && (
        <Notice tone="ok">
          <p>
            {run.result.queued
              ? "Listo: empezó la lectura de todos los feeds. En unos minutos aparecen las notas nuevas."
              : "Ya se pidió hace poco (se puede una vez cada 5 minutos): en unos minutos aparecen las notas nuevas."}
          </p>
        </Notice>
      )}
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { EvidenceSnapshot } from "../../api/types";
import { formatDate, formatDateTime } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

/**
 * ARCHIVO: copia de una nota tal como está hoy, con huella y sello de tiempo, para probar qué
 * se publicó aunque después la editen en silencio o la borren.
 */
export function EvidencePage() {
  const api = useApi();
  const { can } = useSession();
  const list = useAsync(() => (can("evidence_archive") ? api.evidence() : Promise.resolve([])), [api]);
  const [url, setUrl] = useState("");
  const [monitor, setMonitor] = useState(true);
  const capture = useAction(async () => {
    const s = await api.capture(url.trim(), monitor);
    setUrl("");
    await list.reload();
    return s;
  });

  if (!can("evidence_archive")) {
    return (
      <Page title="Archivo de notas" lead="Guardá una copia de una nota con sello de tiempo y enterate si la editan o la borran.">
        <div className="card">
          <p>El archivo viene con el plan Profesional.</p>
          <Link className="btn" to="/planes">
            Ver planes
          </Link>
        </div>
      </Page>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (/^https?:\/\//.test(url.trim())) void capture.run();
  };

  return (
    <Page title="Archivo de notas" lead="Guardá una copia de una nota tal como está hoy. Si después la editan en silencio o la borran, queda la prueba.">
      <form className="card stack" onSubmit={submit} noValidate>
        <Field label="Link de la nota" error={url && !/^https?:\/\//.test(url.trim()) ? "Tiene que empezar con http:// o https://" : undefined}>
          {(p) => <input {...p} className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />}
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={monitor} onChange={(e) => setMonitor(e.target.checked)} />
          <span>Volver a mirarla todos los días durante un mes y avisarme si la editan o la borran</span>
        </label>
        <ErrorAlert error={capture.error} />
        {capture.result && capture.result.status === "captured" && <Notice tone="ok">Guardamos la copia. El sello de tiempo se agrega en unos minutos.</Notice>}
        <div className="row">
          <button className="btn" type="submit" disabled={capture.pending || !/^https?:\/\//.test(url.trim())}>
            {capture.pending ? "Guardando…" : "Guardar copia"}
          </button>
        </div>
      </form>

      <section aria-labelledby="copias" className="stack">
        <h2 id="copias">Tus copias</h2>
        {list.loading && <Spinner />}
        <ErrorAlert error={list.error} />
        {list.data?.length === 0 && <p className="muted">Todavía no guardaste ninguna nota.</p>}
        <ul className="plain-list">
          {list.data?.map((s) => (
            <li key={s.id}>
              <SnapshotView s={s} />
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}

const STATUS: Record<EvidenceSnapshot["status"], [string, string]> = {
  captured: ["Guardada", "badge--fact"],
  gone: ["La borraron", "badge--danger"],
  failed: ["No se pudo guardar", "badge--danger"],
};

function SnapshotView({ s }: { s: EvidenceSnapshot }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const versions = useAsync(() => (open ? api.evidenceHistory(s.url) : Promise.resolve(undefined)), [api, open, s.url]);
  const verify = useAction(() => api.verifyEvidence(s.id));
  const [label, badge] = STATUS[s.status];
  return (
    <article className="card card--flat stack">
      <div className="row">
        <span className={`badge ${badge}`}>{label}</span>
        <span className="muted">{formatDateTime(s.capturedAt)}</span>
        {s.monitorUntil && new Date(s.monitorUntil) > new Date() && <span className="badge badge--neutral">La miramos hasta el {formatDate(s.monitorUntil)}</span>}
      </div>
      <h3 style={{ margin: 0 }}>
        <a href={s.finalUrl} target="_blank" rel="noopener noreferrer">
          {s.title ?? s.finalUrl}
        </a>
      </h3>
      {s.rawSha256 && (
        <p className="muted" style={{ margin: 0 }}>
          Huella (SHA-256): <span className="mono">{s.rawSha256.slice(0, 16)}…</span>
          {s.timestamp ? ` · Sellada el ${formatDateTime(s.timestamp.at)}` : " · Sello de tiempo en camino"}
        </p>
      )}
      {s.error && <p className="muted">{s.error}</p>}
      <div className="row">
        {s.status === "captured" && (
          <>
            <a className="btn btn--ghost btn--small" href={api.evidenceFileUrl(s.id, "text")} download>
              Bajar el texto
            </a>
            <a className="btn btn--ghost btn--small" href={api.evidenceFileUrl(s.id, "raw")} download>
              Bajar el original
            </a>
          </>
        )}
        {s.externalCopies.map((c) => (
          <a key={c.provider} className="btn btn--ghost btn--small" href={c.url} target="_blank" rel="noopener noreferrer">
            Copia pública ({c.provider})
          </a>
        ))}
        <button type="button" className="btn btn--ghost btn--small" onClick={() => void verify.run()} disabled={verify.pending}>
          Verificar que no se alteró
        </button>
        <button type="button" className="btn btn--ghost btn--small" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Ocultar versiones" : "Ver versiones"}
        </button>
      </div>
      <ErrorAlert error={verify.error} />
      {verify.result && (
        <div className={`alert ${verify.result.ok ? "alert--ok" : "alert--error"}`} role="status">
          <p className="alert__title">{verify.result.ok ? "Todo coincide: la copia no se alteró." : "Hay algo que no coincide."}</p>
          <ul>
            {verify.result.checks.map((c) => (
              <li key={c.name}>
                {c.ok ? "✔" : "✖"} {c.name}
                {c.detail && <span className="muted"> — {c.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {open && versions.loading && <Spinner />}
      {open && versions.data && <Versions list={versions.data} />}
    </article>
  );
}

/** Todas las versiones de la nota: qué frases aparecieron y cuáles desaparecieron en cada edición. */
function Versions({ list }: { list: EvidenceSnapshot[] }) {
  return (
    <ol className="plain-list" aria-label="Versiones de la nota">
      {list.map((v, i) => (
        <li key={v.id} className="card card--flat">
          <strong>{i === 0 ? "Primera copia" : v.status === "gone" ? "La borraron" : "Cambió"}</strong> <span className="muted">· {formatDateTime(v.capturedAt)}</span>
          {v.change && (v.change.removed.length > 0 || v.change.added.length > 0) && (
            <ul className="plain-list" style={{ marginTop: "var(--space-2)" }}>
              {v.change.removed.map((r, k) => (
                <li key={`r${k}`} className="finding">
                  <span className="visually-hidden">Quitaron: </span>− <span className="strike">{r}</span>
                </li>
              ))}
              {v.change.added.map((a, k) => (
                <li key={`a${k}`} className="finding finding--fact">
                  <span className="visually-hidden">Agregaron: </span>+ {a}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

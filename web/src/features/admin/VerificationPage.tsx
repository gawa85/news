import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { VerdictStatus, VerificationTask } from "../../api/backofficeTypes";
import { formatDate } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Linked, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { useOutlets } from "../shared/catalog";

const VERDICTS: Record<VerdictStatus, string> = { confirmed: "Confirmado", refuted: "Falso", disputed: "En disputa" };

/**
 * VERIFICACIÓN: datos en disputa que aparecen al comparar medios. Se toma una tarea, se junta
 * evidencia (con link) y se resuelve con una nota. Quien representa a un medio involucrado no puede.
 */
export function VerificationPage() {
  const api = useBackoffice();
  const tasks = useAsync(() => api.verificationTasks(), [api]);
  const [openId, setOpenId] = useState<string>();
  const list = tasks.data ?? [];
  const replace = (t: VerificationTask) => tasks.setData(t.status === "resolved" || t.status === "discarded" ? list.filter((x) => x.id !== t.id) : list.map((x) => (x.id === t.id ? t : x)));
  const current = list.find((t) => t.id === openId);
  return (
    <Page title="Verificación" lead="Datos en disputa entre medios, los más urgentes primero.">
      {tasks.loading && !tasks.data && <Spinner />}
      <ErrorAlert error={tasks.error} />
      {tasks.data && list.length === 0 && <p className="muted">No hay tareas pendientes.</p>}
      <ul className="plain-list stack">
        {list.map((t) => (
          <li key={t.id} className="card card--flat">
            <p style={{ margin: 0 }}>
              <span className="badge badge--neutral">{t.topic}</span> {t.status === "assigned" && <span className="badge badge--smoke">{t.assigneeId ? "Tomada" : ""}</span>}
            </p>
            <p style={{ margin: "var(--space-2) 0" }}>
              <button type="button" className="btn btn--ghost" onClick={() => setOpenId(t.id === openId ? undefined : t.id)} aria-expanded={t.id === openId}>
                {t.question}
              </button>
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Prioridad {t.priority} · {t.claimIds.length} {t.claimIds.length === 1 ? "afirmación" : "afirmaciones"} · {t.evidence.length} evidencias · desde el {formatDate(t.createdAt)}
            </p>
          </li>
        ))}
      </ul>
      {current && <TaskDetail key={current.id} t={current} onChange={replace} />}
    </Page>
  );
}

function TaskDetail({ t, onChange }: { t: VerificationTask; onChange: (t: VerificationTask) => void }) {
  const api = useBackoffice();
  const { me } = useSession();
  const { nameOf } = useOutlets();
  const mine = t.assigneeId === me?.id;
  const act = useAction(async (fn: () => Promise<VerificationTask>) => {
    const next = await fn();
    onChange(next);
    return next;
  });
  return (
    <section className="card stack" aria-labelledby="tarea">
      <h2 id="tarea">{t.question}</h2>
      <p className="muted">
        Medios: {t.outletIds.map(nameOf).join(", ") || "—"} {t.figures.length > 0 && `· cifras en juego: ${t.figures.join(", ")}`}
      </p>
      <div className="row">
        {!mine && (
          <button className="btn" type="button" onClick={() => void act.run(() => api.takeTask(t.id))} disabled={act.pending || (!!t.assigneeId && !mine)}>
            {t.assigneeId ? "La tomó otra persona" : "Tomar la tarea"}
          </button>
        )}
        <button className="btn btn--secondary" type="button" onClick={() => void act.run(() => api.suggestEvidence(t.id))} disabled={act.pending}>
          Buscar en fuentes oficiales
        </button>
      </div>
      <ErrorAlert error={act.error} />

      <h3>Evidencia</h3>
      {t.evidence.length === 0 ? (
        <p className="muted">Todavía no hay evidencia. Para resolver hace falta al menos una con link.</p>
      ) : (
        <ul>
          {t.evidence.map((e, i) => (
            <li key={i}>
              <strong>{e.source}</strong>: <Linked text={e.description} /> {e.value !== undefined && `(${e.value})`} {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer">fuente</a>}
              <span className="muted"> · {e.addedBy === "sistema" ? "sugerida" : "cargada"}</span>
            </li>
          ))}
        </ul>
      )}
      <AddEvidence onAdd={(e) => act.run(() => api.addEvidence(t.id, e))} pending={act.pending} />
      {mine && <Resolve t={t} onResolve={(verdicts, note) => act.run(() => api.resolveTask(t.id, verdicts, note))} onDiscard={(note) => act.run(() => api.discardTask(t.id, note))} pending={act.pending} />}
      {act.result && (act.result.status === "resolved" || act.result.status === "discarded") && (
        <Notice tone="ok">
          <p>{act.result.status === "resolved" ? "Resuelta: el veredicto ya cuenta para la credibilidad de los medios." : "Descartada."}</p>
        </Notice>
      )}
    </section>
  );
}

function AddEvidence({ onAdd, pending }: { onAdd: (e: { source: string; description: string; url?: string }) => Promise<unknown>; pending: boolean }) {
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!source.trim() || !description.trim()) return;
    await onAdd({ source: source.trim(), description: description.trim(), ...(url.trim() ? { url: url.trim() } : {}) });
    setSource("");
    setDescription("");
    setUrl("");
  };
  return (
    <details>
      <summary>Agregar evidencia</summary>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate style={{ marginTop: "var(--space-3)" }}>
        <div className="grid-2">
          <Field label="Fuente">{(p) => <input {...p} className="input" placeholder="INDEC, Boletín Oficial…" value={source} onChange={(e) => setSource(e.target.value)} />}</Field>
          <Field label="Link">{(p) => <input {...p} className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
        </div>
        <Field label="Qué dice">{(p) => <input {...p} className="input" value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <div className="row">
          <button className="btn btn--secondary" type="submit" disabled={pending || !source.trim() || !description.trim()}>
            Agregar
          </button>
        </div>
      </form>
    </details>
  );
}

function Resolve({ t, onResolve, onDiscard, pending }: { t: VerificationTask; onResolve: (v: Record<string, VerdictStatus>, note: string) => void; onDiscard: (note: string) => void; pending: boolean }) {
  const [verdict, setVerdict] = useState<VerdictStatus>("disputed");
  const [note, setNote] = useState("");
  const short = note.trim().length < 20;
  const hasLink = t.evidence.some((e) => e.url);
  return (
    <form className="card card--flat stack" onSubmit={(e) => e.preventDefault()} noValidate aria-labelledby="resolver">
      <h3 id="resolver">Resolver</h3>
      <fieldset>
        <legend className="field__label">Veredicto</legend>
        <div className="row">
          {(Object.keys(VERDICTS) as VerdictStatus[]).map((v) => (
            <label key={v} className="row">
              <input type="radio" name="veredicto" checked={verdict === v} onChange={() => setVerdict(v)} />
              {VERDICTS[v]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Nota (se publica con el veredicto)" hint="Al menos 20 caracteres: qué dice la evidencia y por qué.">
        {(p) => <textarea {...p} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      {!hasLink && <p className="muted">Para resolver hace falta al menos una evidencia con link.</p>}
      <div className="row">
        <button className="btn" type="button" disabled={pending || short || !hasLink} onClick={() => onResolve(Object.fromEntries(t.claimIds.map((c) => [c, verdict])), note.trim())}>
          Resolver
        </button>
        <button className="btn btn--ghost" type="button" disabled={pending || short} onClick={() => onDiscard(note.trim())}>
          Descartar (no se puede verificar)
        </button>
      </div>
    </form>
  );
}

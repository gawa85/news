import { useState } from "react";
import { Link } from "react-router";
import { useBackoffice } from "../../api/BackofficeContext";
import type { VerificationTask } from "../../api/backofficeTypes";
import type { RepeatedClaim } from "../../api/types";
import { formatDate } from "../../domain/labels";
import { ErrorAlert, Spinner } from "../../ui/components";
import { useAction } from "../../ui/useAsync";
import { TaskDetail } from "../admin/VerificationPage";

const STATE: Record<VerificationTask["status"], { label: string; tone: string }> = {
  open: { label: "Mandado a verificar", tone: "badge--neutral" },
  assigned: { label: "En verificación", tone: "badge--smoke" },
  resolved: { label: "Verificado", tone: "badge--fact" },
  discarded: { label: "Descartado", tone: "badge--neutral" },
};

/** Lo que se busca: el dato sin comillas y corto (los buscadores cortan las frases largas). */
function searchText(text: string, max = 120): string {
  const clean = text.replace(/[«»"“”]/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, clean.lastIndexOf(" ", max) > 40 ? clean.lastIndexOf(" ", max) : max);
}

/** Dónde buscar información sobre el dato (se abren en otra pestaña; no se manda nada desde acá). */
export function searchLinks(c: Pick<RepeatedClaim, "text" | "topic">): { label: string; url: string }[] {
  const q = encodeURIComponent(searchText(c.text));
  return [
    { label: "Google", url: `https://www.google.com/search?q=${q}` },
    { label: "Google Noticias", url: `https://news.google.com/search?q=${q}&hl=es-419&gl=AR&ceid=AR:es-419` },
    { label: "Chequeado", url: `https://chequeado.com/?s=${q}` },
    { label: "Datos oficiales (datos.gob.ar)", url: `https://datos.gob.ar/dataset?q=${encodeURIComponent(c.topic)}` },
  ];
}

/** Las frases agrupadas por nota: cada nota aparece una vez (con su título), y debajo lo que dice. */
function notesOf(c: RepeatedClaim) {
  const notes = new Map<string, { url: string; title: string; outletName: string; publishedAt: string; claims: RepeatedClaim["claims"] }>();
  for (const x of c.claims) {
    const key = x.articleUrl || x.claimId;
    const n = notes.get(key) ?? { url: x.articleUrl, title: x.articleTitle, outletName: x.outletName, publishedAt: x.publishedAt, claims: [] };
    n.claims.push(x);
    notes.set(key, n);
  }
  return [...notes.values()];
}

/**
 * Un dato repetido entre medios: qué dijo cada uno (y analizar cada nota completa), dónde buscar información,
 * rastrear quién lo dijo primero y, para el equipo de verificación, verificarlo ahí mismo.
 */
export function RepeatedClaimItem({ c, index, canVerify, open, onToggle }: { c: RepeatedClaim; index: number; canVerify: boolean; open: boolean; onToggle: () => void }) {
  const bo = useBackoffice();
  const [task, setTask] = useState<VerificationTask>();
  const status = task?.status ?? c.task?.status;
  const panelId = `verificar-${index}`;
  const firstUrl = c.claims.find((x) => x.articleUrl)?.articleUrl;

  // Abrir el panel: si no hay tarea, se crea y se toma en el mismo paso; si hay, se trae.
  const start = useAction(async () => {
    if (!c.task) return setTask(await bo.createVerificationTask(c.claims.map((x) => x.claimId), true));
    const found = (await bo.verificationTasks()).find((t) => t.id === c.task!.id);
    setTask(found ?? (await bo.createVerificationTask(c.claims.map((x) => x.claimId), false)));
  });
  const toggle = () => {
    if (!open && !task) void start.run();
    onToggle();
  };

  return (
    <li className="card card--flat stack">
      <p style={{ margin: 0 }}>«{c.text}»</p>
      <p className="muted" style={{ margin: 0 }}>
        Lo publican {c.outlets.length} medios: {c.outlets.join(", ")}.
        {c.conflicting && (
          <>
            {" "}
            <span className="badge badge--smoke">No dan la misma cifra</span>
          </>
        )}
        {status && (
          <>
            {" "}
            <span className={`badge ${STATE[status].tone}`}>{STATE[status].label}</span>
          </>
        )}
      </p>

      <details>
        <summary>Qué dijo cada medio</summary>
        <ul className="stack" style={{ marginTop: "var(--space-2)" }}>
          {notesOf(c).map((n) => (
            <li key={n.url || n.claims[0]!.claimId} className="stack" style={{ gap: "var(--space-1)" }}>
              <p style={{ margin: 0 }}>
                <strong>{n.outletName}</strong>
                {n.title && <> · «{n.title}»</>}
                {n.publishedAt && <span className="muted"> · {formatDate(n.publishedAt)}</span>}
              </p>
              <ul style={{ margin: 0 }}>
                {n.claims.map((x) => (
                  <li key={x.claimId}>«{x.text}»</li>
                ))}
              </ul>
              {n.url && (
                <p className="row" style={{ flexWrap: "wrap", margin: 0 }}>
                  <a href={n.url} target="_blank" rel="noopener noreferrer">
                    Ver la nota<span className="visually-hidden"> de {n.outletName} (se abre en otra pestaña)</span>
                  </a>
                  <Link to={`/analizar?url=${encodeURIComponent(n.url)}`}>
                    Analizar la nota<span className="visually-hidden"> de {n.outletName}</span>
                  </Link>
                </p>
              )}
            </li>
          ))}
        </ul>
      </details>

      <details>
        <summary>Buscar información</summary>
        <ul className="row" style={{ flexWrap: "wrap", listStyle: "none", padding: 0, marginTop: "var(--space-2)" }}>
          {searchLinks(c).map((l) => (
            <li key={l.label}>
              <a className="btn btn--ghost btn--small" href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label}
                <span className="visually-hidden"> (se abre en otra pestaña)</span>
              </a>
            </li>
          ))}
        </ul>
      </details>

      <div className="row" style={{ flexWrap: "wrap" }}>
        {firstUrl && (
          <Link className="btn btn--ghost btn--small" to={`/origen?url=${encodeURIComponent(firstUrl)}`}>
            ¿Quién lo dijo primero?
          </Link>
        )}
        {canVerify && status !== "resolved" && status !== "discarded" && (
          <button className="btn btn--secondary btn--small" type="button" aria-expanded={open} aria-controls={panelId} onClick={toggle}>
            {open ? "Cerrar la verificación" : c.task ? "Seguir verificando" : "Verificar acá"}
          </button>
        )}
      </div>

      {canVerify && open && (
        <div id={panelId} className="stack">
          {start.pending && <Spinner />}
          <ErrorAlert error={start.error} title="No se pudo abrir la verificación" />
          {task && <TaskDetail key={task.id} t={task} onChange={setTask} />}
        </div>
      )}
    </li>
  );
}

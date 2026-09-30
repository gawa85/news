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

/**
 * Un dato repetido entre medios: qué dijo cada uno, dónde buscar información, analizarlo,
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
          {c.claims.map((x) => (
            <li key={x.claimId}>
              <strong>{x.outletName}</strong>: «{x.text}»{" "}
              {x.articleUrl && (
                <a href={x.articleUrl} target="_blank" rel="noopener noreferrer">
                  Ver la nota{x.publishedAt ? ` del ${formatDate(x.publishedAt)}` : ""}
                  <span className="visually-hidden"> de {x.outletName} (se abre en otra pestaña)</span>
                </a>
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
        <Link className="btn btn--ghost btn--small" to={`/analizar?texto=${encodeURIComponent(c.text)}`}>
          Analizar el texto
        </Link>
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

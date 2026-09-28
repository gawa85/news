import { useState } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { PendingRebuttal, RebuttalDecision } from "../../api/backofficeTypes";
import { formatDate } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { useOutlets } from "../shared/catalog";

const DECISIONS: Record<RebuttalDecision, string> = { accepted: "Aceptar", partially_accepted: "Aceptar en parte", rejected: "Rechazar" };

const targetText = (r: PendingRebuttal) =>
  r.target.type === "credibility" ? `Su credibilidad en «${r.target.topic}»` : r.target.type === "verdict" ? "Un veredicto sobre una afirmación suya" : "Una respuesta publicada";

/**
 * RÉPLICAS: el derecho a réplica de los medios. Resuelve otra persona (no quien la presentó ni
 * quien representa al medio). Aceptar publica una fe de erratas y, si corresponde, corrige el veredicto.
 */
export function RebuttalsPage() {
  const api = useBackoffice();
  const list = useAsync(() => api.pendingRebuttals(), [api]);
  const [done, setDone] = useState<string>();
  const items = list.data ?? [];
  return (
    <Page title="Réplicas de medios" lead="Pedidos de corrección de los medios, los más viejos primero.">
      {list.loading && !list.data && <Spinner />}
      <ErrorAlert error={list.error} />
      {done && (
        <Notice tone="ok">
          <p>{done}</p>
        </Notice>
      )}
      {list.data && items.length === 0 && <p className="muted">No hay réplicas por resolver.</p>}
      <ul className="plain-list stack">
        {items.map((r) => (
          <RebuttalItem
            key={r.id}
            r={r}
            onResolved={(decision) => {
              setDone(decision === "rejected" ? "Réplica rechazada." : "Réplica aceptada: se publicó la fe de erratas.");
              list.setData(items.filter((x) => x.id !== r.id));
            }}
          />
        ))}
      </ul>
    </Page>
  );
}

function RebuttalItem({ r, onResolved }: { r: PendingRebuttal; onResolved: (d: RebuttalDecision) => void }) {
  const api = useBackoffice();
  const { nameOf } = useOutlets();
  const [decision, setDecision] = useState<RebuttalDecision>("accepted");
  const [note, setNote] = useState("");
  const resolve = useAction(async () => {
    await api.resolveRebuttal(r.id, decision, note.trim());
    onResolved(decision);
  });
  const name = `réplica de ${nameOf(r.outletId)}`;
  return (
    <li className="card stack">
      <h2 style={{ margin: 0 }}>{nameOf(r.outletId)}</h2>
      <p className="muted" style={{ margin: 0 }}>
        {targetText(r)} · presentada el {formatDate(r.createdAt)}
      </p>
      <blockquote style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.statement}</blockquote>
      {r.evidenceUrls.length > 0 && (
        <ul>
          {r.evidenceUrls.map((u) => (
            <li key={u}>
              <a href={u} target="_blank" rel="noopener noreferrer">
                {u}
              </a>
            </li>
          ))}
        </ul>
      )}
      <fieldset>
        <legend className="field__label">Decisión sobre la {name}</legend>
        <div className="row">
          {(Object.keys(DECISIONS) as RebuttalDecision[]).map((d) => (
            <label key={d} className="row">
              <input type="radio" name={`decision-${r.id}`} checked={decision === d} onChange={() => setDecision(d)} />
              {DECISIONS[d]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Fundamento (se publica)" hint="Al menos 20 caracteres.">
        {(p) => <textarea {...p} className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className="row">
        <button className="btn" type="button" onClick={() => void resolve.run()} disabled={resolve.pending || note.trim().length < 20}>
          {resolve.pending ? "Guardando…" : "Resolver"}
        </button>
      </div>
      <ErrorAlert error={resolve.error} />
    </li>
  );
}

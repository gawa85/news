import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { AgentTicket, TicketStatus } from "../../api/backofficeTypes";
import { formatDateTime } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const PRIORITY: Record<AgentTicket["priority"], [string, string]> = {
  urgent: ["Urgente", "badge--danger"],
  high: ["Alta", "badge--smoke"],
  normal: ["Normal", "badge--neutral"],
  low: ["Baja", "badge--neutral"],
};
const STATUS: Record<TicketStatus, string> = { open: "Abierto", pending: "Esperando a la persona", solved: "Resuelto", closed: "Cerrado" };
const ROLE: Record<string, string> = { requester: "Persona", agent: "Soporte", system: "Sistema" };

/** SOPORTE: la cola (urgentes y vencidos primero) y responder, con notas internas. */
export function SupportQueuePage() {
  const api = useBackoffice();
  const queue = useAsync(() => api.supportQueue(), [api]);
  const [openId, setOpenId] = useState<string>();
  const tickets = queue.data ?? [];
  const current = tickets.find((t) => t.id === openId);
  const replace = (t: AgentTicket) => queue.setData(tickets.map((x) => (x.id === t.id ? t : x)));

  return (
    <Page title="Soporte" lead="Consultas abiertas, las urgentes y las que vencen primero arriba.">
      {queue.loading && !queue.data && <Spinner />}
      <ErrorAlert error={queue.error} />
      {queue.data && tickets.length === 0 && <p className="muted">No hay consultas abiertas.</p>}
      {tickets.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption>Consultas abiertas ({tickets.length})</caption>
            <thead>
              <tr>
                <th scope="col">Consulta</th>
                <th scope="col">Prioridad</th>
                <th scope="col">Estado</th>
                <th scope="col">Primera respuesta</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} aria-current={t.id === openId ? "true" : undefined}>
                  <th scope="row">
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => setOpenId(t.id)} aria-expanded={t.id === openId}>
                      {t.id} · {t.subject}
                    </button>
                  </th>
                  <td>
                    <span className={`badge ${PRIORITY[t.priority][1]}`}>{PRIORITY[t.priority][0]}</span>
                  </td>
                  <td>{STATUS[t.status]}</td>
                  <td>
                    {t.firstRespondedAt ? "Respondida" : t.slaBreached ? <span className="badge badge--danger">Vencida</span> : `Vence ${formatDateTime(t.firstResponseDueAt)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {current && <TicketDetail key={current.id} t={current} onChange={replace} />}
    </Page>
  );
}

function TicketDetail({ t, onChange }: { t: AgentTicket; onChange: (t: AgentTicket) => void }) {
  const api = useBackoffice();
  const [text, setText] = useState("");
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState<TicketStatus | "">("");
  const reply = useAction(async () => {
    const updated = await api.replyAsAgent(t.id, text.trim(), { internal, ...(status ? { status } : {}) });
    onChange(updated);
    setText("");
    setStatus("");
    return updated;
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) void reply.run();
  };
  return (
    <section className="card stack" aria-labelledby="detalle-ticket">
      <h2 id="detalle-ticket">
        {t.id} · {t.subject}
      </h2>
      <p className="muted">
        Categoría: {t.category} · por {t.channel} · abierta el {formatDateTime(t.createdAt)}
      </p>
      <ol className="plain-list stack">
        {t.messages.map((m) => (
          <li key={m.id} className={m.internal ? "finding" : "card card--flat"}>
            <p className="muted" style={{ margin: 0 }}>
              <strong>{ROLE[m.role] ?? m.role}</strong> · {formatDateTime(m.at)} {m.internal && <span className="badge badge--smoke">Nota interna</span>}
            </p>
            <p style={{ whiteSpace: "pre-wrap", margin: "var(--space-1) 0 0" }}>{m.text}</p>
          </li>
        ))}
      </ol>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label={internal ? "Nota interna (no la ve la persona)" : "Respuesta"}>
          {(p) => <textarea {...p} className="textarea" maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="row">
          <label className="row">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            Es una nota interna
          </label>
          <Field label="Cambiar el estado">
            {(p) => (
              <select {...p} className="select" value={status} onChange={(e) => setStatus(e.target.value as TicketStatus | "")}>
                <option value="">{internal ? "Dejarlo como está" : "Esperando a la persona (por defecto)"}</option>
                <option value="open">Abierto</option>
                <option value="pending">Esperando a la persona</option>
                <option value="solved">Resuelto</option>
                <option value="closed">Cerrado</option>
              </select>
            )}
          </Field>
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={reply.pending || !text.trim()}>
            {reply.pending ? "Enviando…" : internal ? "Guardar nota" : "Responder"}
          </button>
        </div>
        <ErrorAlert error={reply.error} />
        {reply.result && !reply.pending && (
          <Notice tone="ok">
            <p>{internal ? "Nota guardada." : "Respuesta enviada: le avisamos a la persona."}</p>
          </Notice>
        )}
      </form>
    </section>
  );
}

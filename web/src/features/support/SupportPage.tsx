import { useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiContext";
import type { Ticket, TicketCategory } from "../../api/types";
import { formatDateTime } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const CATEGORIES: Record<TicketCategory, string> = {
  account: "Mi cuenta",
  billing: "Pagos y facturas",
  bug: "Algo no funciona",
  content_dispute: "No estoy de acuerdo con un análisis",
  data_request: "Mis datos personales",
  other: "Otra cosa",
};
const STATUS: Record<Ticket["status"], [string, string]> = {
  open: ["Abierta", "badge--smoke"],
  pending: ["Esperando tu respuesta", "badge--smoke"],
  solved: ["Resuelta", "badge--fact"],
  closed: ["Cerrada", "badge--neutral"],
};

/** AYUDA: hablar con una persona del equipo (también por WhatsApp con /soporte). */
export function SupportPage() {
  const api = useApi();
  const list = useAsync(() => api.tickets(), [api]);
  const [category, setCategory] = useState<TicketCategory>("other");
  const [text, setText] = useState("");
  const open = useAction(async () => {
    const t = await api.openTicket({ text: text.trim(), category });
    setText("");
    await list.reload();
    return t;
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length >= 5) void open.run();
  };

  return (
    <Page title="Ayuda" lead="Escribinos y te responde una persona del equipo. También podés hacerlo por WhatsApp o Telegram con /soporte.">
      <form className="card stack" onSubmit={submit}>
        <h2>Nueva consulta</h2>
        <Field label="¿Sobre qué es?">
          {(p) => (
            <select {...p} className="select" value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Contanos qué pasó">{(p) => <textarea {...p} className="textarea" value={text} onChange={(e) => setText(e.target.value)} />}</Field>
        <ErrorAlert error={open.error} />
        {open.result && (
          <Notice tone="ok">
            Abrimos la consulta {open.result.id}. Te respondemos antes del {formatDateTime(open.result.firstResponseDueAt)}.
          </Notice>
        )}
        <div className="row">
          <button className="btn" type="submit" disabled={open.pending || text.trim().length < 5}>
            {open.pending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      </form>

      <section aria-labelledby="mis-consultas" className="stack">
        <h2 id="mis-consultas">Tus consultas</h2>
        {list.loading && <Spinner />}
        <ErrorAlert error={list.error} />
        {list.data?.length === 0 && <p className="muted">Todavía no hiciste ninguna consulta.</p>}
        {list.data?.map((t) => (
          <TicketView key={t.id} ticket={t} onChange={() => void list.reload()} />
        ))}
      </section>
    </Page>
  );
}

function TicketView({ ticket, onChange }: { ticket: Ticket; onChange: () => void }) {
  const api = useApi();
  const [reply, setReply] = useState("");
  const send = useAction(async () => {
    await api.replyTicket(ticket.id, reply.trim());
    setReply("");
    onChange();
    return true;
  });
  const rate = useAction(async (score: number) => {
    await api.rateTicket(ticket.id, score);
    onChange();
    return true;
  });
  const [label, badge] = STATUS[ticket.status];
  const visible = ticket.messages.filter((m) => m.role !== "system");
  return (
    <details className="card card--flat">
      <summary>
        <span className={`badge ${badge}`}>{label}</span> <strong>{ticket.subject}</strong> <span className="muted">· {ticket.id} · {formatDateTime(ticket.updatedAt)}</span>
      </summary>
      <ol className="plain-list" style={{ marginTop: "var(--space-4)" }}>
        {visible.map((m) => (
          <li key={m.id} className={m.role === "agent" ? "finding finding--fact" : "finding"} style={m.role === "agent" ? undefined : { background: "var(--surface-2)", borderColor: "var(--border-strong)" }}>
            <strong>{m.role === "agent" ? "Equipo de Sin Humo" : "Vos"}</strong> <span className="muted">· {formatDateTime(m.at)}</span>
            <p style={{ whiteSpace: "pre-wrap", margin: "var(--space-1) 0 0" }}>{m.text}</p>
          </li>
        ))}
      </ol>
      {ticket.status !== "closed" && (
        <form
          className="stack"
          style={{ marginTop: "var(--space-4)" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) void send.run();
          }}
        >
          <Field label="Responder">{(p) => <textarea {...p} className="textarea" style={{ minHeight: "5rem" }} value={reply} onChange={(e) => setReply(e.target.value)} />}</Field>
          <ErrorAlert error={send.error} />
          <div className="row">
            <button className="btn btn--secondary" type="submit" disabled={send.pending || !reply.trim()}>
              Enviar respuesta
            </button>
          </div>
        </form>
      )}
      {ticket.status === "solved" && !ticket.satisfaction && (
        <fieldset style={{ marginTop: "var(--space-4)" }}>
          <legend>¿Cómo te atendimos?</legend>
          <div className="row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className="btn btn--secondary btn--small" onClick={() => void rate.run(n)} aria-label={`${n} de 5`}>
                {n}
              </button>
            ))}
          </div>
          <ErrorAlert error={rate.error} />
        </fieldset>
      )}
      {ticket.satisfaction && <p className="muted">Calificaste la atención con {ticket.satisfaction} de 5. ¡Gracias!</p>}
    </details>
  );
}

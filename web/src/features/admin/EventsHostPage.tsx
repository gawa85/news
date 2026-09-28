import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import { useBackoffice } from "../../api/BackofficeContext";
import type { PublicEvent, RoomMessage } from "../../api/types";
import { formatDateTime } from "../../domain/labels";
import { ErrorAlert, Field, Linked, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const STATUS: Record<PublicEvent["status"], string> = { live: "En vivo", scheduled: "Programado", closed: "Terminó" };

/** Fecha y hora local para <input type="datetime-local"> (sin segundos). */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** EVENTOS (quien organiza): crear y moderar en vivo — chequeos fijados, silenciar y cerrar. */
export function EventsHostPage() {
  const api = useBackoffice();
  const list = useAsync(() => api.hostedEvents(), [api]);
  const [openId, setOpenId] = useState<string>();
  const events = list.data ?? [];
  const current = events.find((e) => e.id === openId);
  return (
    <Page title="Eventos en vivo" lead="Debates, elecciones, cadenas nacionales: una sala pública con chequeos en el momento.">
      <NewEvent onCreated={() => void list.reload()} />
      <section className="card stack" aria-labelledby="mis-eventos">
        <h2 id="mis-eventos">Tus eventos</h2>
        {list.loading && !list.data && <Spinner />}
        <ErrorAlert error={list.error} />
        {list.data && events.length === 0 && <p className="muted">No hay eventos.</p>}
        <ul className="plain-list stack">
          {events.map((e) => (
            <li key={e.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <span className={`badge ${e.status === "live" ? "badge--danger" : "badge--neutral"}`}>{STATUS[e.status]}</span> <strong>{e.title}</strong>{" "}
                <span className="muted">
                  · {formatDateTime(e.startsAt)} · código <span className="mono">{e.code}</span>
                </span>
              </span>
              {e.status !== "closed" && (
                <button className="btn btn--secondary btn--small" type="button" onClick={() => setOpenId(e.id)} aria-expanded={e.id === openId}>
                  Moderar
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      {current && <Console key={current.id} e={current} onClosed={() => void list.reload()} />}
    </Page>
  );
}

function NewEvent({ onCreated }: { onCreated: () => void }) {
  const api = useBackoffice();
  const [title, setTitle] = useState("");
  const [host, setHost] = useState("");
  const [startsAt, setStartsAt] = useState(localInput(new Date()));
  const [hours, setHours] = useState(2);
  const [created, setCreated] = useState<string>();
  const create = useAction(async () => {
    const start = new Date(startsAt);
    const r = await api.createEvent({ title: title.trim(), ...(host.trim() ? { host: host.trim() } : {}), startsAt: start.toISOString(), endsAt: new Date(start.getTime() + hours * 3_600_000).toISOString() });
    setCreated(r.event?.code);
    setTitle("");
    onCreated();
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length >= 5) void create.run();
  };
  return (
    <form className="card stack" onSubmit={submit} noValidate aria-labelledby="nuevo-evento">
      <h2 id="nuevo-evento">Nuevo evento</h2>
      <div className="grid-2">
        <Field label="Título" hint="Al menos 5 letras.">{(p) => <input {...p} className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Organiza (lo que ve el público)" hint="Por defecto, Sin Humo.">{(p) => <input {...p} className="input" maxLength={80} value={host} onChange={(e) => setHost(e.target.value)} />}</Field>
        <Field label="Empieza">{(p) => <input {...p} className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}</Field>
        <Field label="Duración (horas)" hint="Hasta 24.">{(p) => <input {...p} className="input" type="number" min={1} max={24} value={hours} onChange={(e) => setHours(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} />}</Field>
      </div>
      <div className="row">
        <button className="btn" type="submit" disabled={create.pending || title.trim().length < 5}>
          {create.pending ? "Creando…" : "Crear evento"}
        </button>
      </div>
      <ErrorAlert error={create.error} />
      {created && (
        <Notice tone="ok">
          <p>
            Listo. Link público: <Link to={`/eventos/${created}`}>/eventos/{created}</Link> · por chat: <span className="mono">/evento {created}</span>
          </p>
        </Notice>
      )}
    </form>
  );
}

/** Consola en vivo: la conversación (con seudónimos), chequeos y moderación. */
function Console({ e, onClosed }: { e: PublicEvent; onClosed: () => void }) {
  const pub = useApi();
  const api = useBackoffice();
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [check, setCheck] = useState("");
  const [muted, setMuted] = useState<string>();
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(
    () =>
      pub.watchEvent(e.code, (ev) => {
        if (ev.type === "history") setMessages(ev.messages);
        if (ev.type === "message") setMessages((m) => [...m.filter((x) => x.id !== ev.message.id), ev.message]);
        if (ev.type === "deleted") setMessages((m) => m.filter((x) => x.id !== ev.messageId));
      }),
    [pub, e.code],
  );
  const post = useAction(async () => {
    await api.factCheck(e.id, check.trim());
    setCheck("");
  });
  const mute = useAction(async (m: RoomMessage, remove: boolean) => {
    const r = await api.muteAuthor(m.id, 30, remove);
    setMuted(`${m.alias ?? "La persona"} no puede escribir hasta las ${formatDateTime(r.until)}.${remove ? " El mensaje se borró." : ""}`);
  });
  const close = useAction(async () => {
    await api.closeEvent(e.id);
    onClosed();
  });
  return (
    <section className="card stack" aria-labelledby="consola">
      <h2 id="consola">Moderar: {e.title}</h2>
      <form
        className="stack"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (check.trim()) void post.run();
        }}
      >
        <Field label="Publicar un chequeo" hint="Se fija arriba de la sala y les llega a quienes se suscribieron por chat. Sumá la fuente.">
          {(p) => <textarea {...p} className="textarea" style={{ minHeight: "4.5rem" }} maxLength={4000} value={check} onChange={(ev) => setCheck(ev.target.value)} />}
        </Field>
        <div className="row">
          <button className="btn" type="submit" disabled={post.pending || !check.trim()}>
            Publicar chequeo
          </button>
        </div>
        <ErrorAlert error={post.error} />
      </form>
      {muted && (
        <Notice tone="ok">
          <p>{muted}</p>
        </Notice>
      )}
      <ErrorAlert error={mute.error} />
      <h3>Conversación</h3>
      {messages.length === 0 && <p className="muted">Nadie escribió todavía.</p>}
      <ol className="plain-list stack" aria-live="polite" aria-relevant="additions">
        {messages.map((m) => (
          <li key={m.id} className={m.flags.includes("verificacion") ? "finding finding--fact" : undefined}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <strong>{m.alias ?? "Equipo"}</strong> <span className="muted">· {formatDateTime(m.at)}</span>
              </span>
              {!m.flags.includes("verificacion") && (
                <span className="row">
                  <button className="btn btn--ghost btn--small" type="button" onClick={() => void mute.run(m, false)} disabled={mute.pending} aria-label={`Silenciar 30 minutos a ${m.alias ?? "quien escribió"}`}>
                    Silenciar 30 min
                  </button>
                  <button className="btn btn--ghost btn--small" type="button" onClick={() => void mute.run(m, true)} disabled={mute.pending} aria-label={`Silenciar y borrar el mensaje de ${m.alias ?? "quien escribió"}`}>
                    Silenciar y borrar
                  </button>
                </span>
              )}
            </div>
            <p style={{ margin: "var(--space-1) 0 0", overflowWrap: "anywhere" }}>
              <Linked text={m.text} />
            </p>
          </li>
        ))}
      </ol>
      <div className="row">
        {confirmClose ? (
          <span className="row" role="group" aria-label="Confirmar el cierre del evento">
            <button className="btn btn--danger" type="button" onClick={() => void close.run()} disabled={close.pending}>
              Sí, cerrar el evento
            </button>
            <button className="btn btn--ghost" type="button" onClick={() => setConfirmClose(false)}>
              No
            </button>
          </span>
        ) : (
          <button className="btn btn--secondary" type="button" onClick={() => setConfirmClose(true)}>
            Cerrar el evento
          </button>
        )}
      </div>
      <ErrorAlert error={close.error} />
    </section>
  );
}

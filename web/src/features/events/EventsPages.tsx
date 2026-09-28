import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { PublicEvent, RoomMessage } from "../../api/types";
import { formatDateTime } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const STATUS: Record<PublicEvent["status"], [string, string]> = {
  live: ["En vivo", "badge--danger"],
  scheduled: ["Próximamente", "badge--neutral"],
  closed: ["Terminó", "badge--neutral"],
};

/** EVENTOS EN VIVO (público): debates, elecciones, cadenas nacionales con chequeos en el momento. */
export function EventsPage() {
  const api = useApi();
  const list = useAsync(() => api.events(), [api]);
  return (
    <Page title="Eventos en vivo" lead="Debates, elecciones y cadenas nacionales con chequeos en el momento. Se pueden seguir sin cuenta.">
      {list.loading && <Spinner />}
      <ErrorAlert error={list.error} />
      {list.data?.length === 0 && <p className="muted">No hay eventos ahora. Cuando haya un debate o una elección, lo vas a ver acá.</p>}
      <ul className="plain-list">
        {list.data?.map((e) => (
          <li key={e.id} className="card card--flat">
            <div className="row">
              <span className={`badge ${STATUS[e.status][1]}`}>{STATUS[e.status][0]}</span>
              <span className="muted">
                {formatDateTime(e.startsAt)} · organiza {e.host}
              </span>
            </div>
            <h2 style={{ margin: "var(--space-2) 0" }}>
              <Link to={`/eventos/${e.code}`}>{e.title}</Link>
            </h2>
            {e.description && <p className="muted">{e.description}</p>}
          </li>
        ))}
      </ul>
    </Page>
  );
}

/** Un evento: chequeos fijados arriba y la conversación en vivo (anunciada sin robar el foco). */
export function EventPage() {
  const api = useApi();
  const { me } = useSession();
  const { code = "" } = useParams();
  const ev = useAsync(() => api.event(code), [api, code]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [watching, setWatching] = useState<number>();
  const [closed, setClosed] = useState(false);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (!ev.data) return;
    return api.watchEvent(
      code,
      (e) => {
        setLost(false);
        if (e.type === "history") setMessages(e.messages);
        if (e.type === "message") setMessages((m) => [...m.filter((x) => x.id !== e.message.id), e.message]);
        if (e.type === "deleted") setMessages((m) => m.filter((x) => x.id !== e.messageId));
        if (e.type === "presence" && e.count !== undefined) setWatching(e.count);
        if (e.type === "closed") setClosed(true);
      },
      () => setLost(true),
    );
  }, [api, code, ev.data]);

  if (ev.loading) return <div className="page"><Spinner /></div>;
  if (!ev.data) return <Page title="Evento"><ErrorAlert error={ev.error} /></Page>;
  const e = ev.data;
  const status = closed ? "closed" : e.status;
  const checks = [...e.pinned, ...messages.filter((m) => m.flags.includes("verificacion") && !e.pinned.some((p) => p.id === m.id))];
  const chat = messages.filter((m) => !m.flags.includes("verificacion"));

  return (
    <Page title={e.title} lead={e.description}>
      <div className="row">
        <span className={`badge ${STATUS[status][1]}`}>{STATUS[status][0]}</span>
        <span className="muted">Organiza {e.host}</span>
        {watching !== undefined && <span className="muted">· {watching} {watching === 1 ? "persona mirando" : "personas mirando"}</span>}
        {lost && status !== "closed" && <span className="muted">· reconectando…</span>}
      </div>

      <section aria-labelledby="chequeos" className="card stack">
        <h2 id="chequeos">Chequeos del equipo</h2>
        {checks.length === 0 ? (
          <p className="muted">Todavía no hay chequeos. Aparecen acá en cuanto el equipo verifica algo.</p>
        ) : (
          <ol className="plain-list" aria-live="polite">
            {checks.map((m) => (
              <li key={m.id} className="finding finding--fact">
                <span className="muted">{formatDateTime(m.at)}</span>
                <p style={{ margin: "var(--space-1) 0 0" }}>{m.text}</p>
              </li>
            ))}
          </ol>
        )}
        <p className="muted">
          Recibilos por WhatsApp o Telegram: mandá <span className="mono">/evento {e.code}</span>.
        </p>
      </section>

      <section aria-labelledby="conversacion" className="card stack">
        <h2 id="conversacion">Conversación</h2>
        {chat.length === 0 && <p className="muted">Nadie escribió todavía.</p>}
        {/* Los mensajes nuevos se anuncian sin mover el foco (WCAG: salas en tiempo real). */}
        <ol className="plain-list" aria-live="polite" aria-relevant="additions">
          {chat.map((m) => (
            <li key={m.id}>
              <strong>{m.alias ?? "Participante"}</strong> <span className="muted">· {formatDateTime(m.at)}</span>
              {m.flags.includes("sin_fuente") && <span className="badge badge--smoke" style={{ marginInlineStart: "var(--space-2)" }}>Cifra sin fuente</span>}
              <p style={{ margin: "var(--space-1) 0 0", whiteSpace: "pre-wrap" }}>{m.text}</p>
            </li>
          ))}
        </ol>
        {status === "live" && (me ? <PostForm roomId={e.id} /> : <p><Link to={`/entrar?next=${encodeURIComponent(`/eventos/${e.code}`)}`}>Entrá</Link> para escribir.</p>)}
      </section>
    </Page>
  );
}

function PostForm({ roomId }: { roomId: string }) {
  const api = useApi();
  const [text, setText] = useState("");
  const post = useAction(async () => {
    await api.postToRoom(roomId, text.trim());
    setText("");
    return true;
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) void post.run();
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Tu mensaje" hint="Aparecés con un seudónimo. Si das una cifra, sumá el link de la fuente.">
        {(p) => <textarea {...p} className="textarea" style={{ minHeight: "4.5rem" }} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <ErrorAlert error={post.error} />
      <div className="row">
        <button className="btn" type="submit" disabled={post.pending || !text.trim()}>
          Enviar
        </button>
      </div>
    </form>
  );
}

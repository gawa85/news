import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { RoomMessage, TeamRoomDetails } from "../../api/types";
import { formatDate, formatDateTime } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Linked, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const LEAD = "Salas de trabajo de tu equipo: para chequear un tema entre todos, en vivo.";

/** Aviso cuando la cuenta no es de un equipo con el plan que incluye salas. */
function NotAvailable() {
  const { me } = useSession();
  return (
    <Page title="Salas del equipo" lead={LEAD}>
      <div className="card">
        {me?.organizationId ? (
          <p>
            Las salas vienen con los planes Equipo y Empresa. <Link to="/planes">Ver planes</Link>
          </p>
        ) : (
          <p>
            Las salas son para equipos de una organización (medios, consultoras, ONG). <Link to="/planes">Mirá los planes para equipos</Link>.
          </p>
        )}
      </div>
    </Page>
  );
}

/** SALAS DEL EQUIPO: la lista y crear una nueva. */
export function TeamRoomsPage() {
  const api = useApi();
  const { can } = useSession();
  const list = useAsync(() => (can("team_rooms") ? api.rooms() : Promise.resolve([])), [api]);
  if (!can("team_rooms")) return <NotAvailable />;
  return (
    <Page title="Salas del equipo" lead={LEAD}>
      <NewRoom />
      <section className="card stack" aria-labelledby="salas">
        <h2 id="salas">Salas abiertas</h2>
        {list.loading && <Spinner />}
        <ErrorAlert error={list.error} />
        {list.data?.length === 0 && <p className="muted">Todavía no hay salas. Creá la primera.</p>}
        <ul className="plain-list">
          {list.data?.map((r) => (
            <li key={r.id} className="card card--flat">
              <h3 style={{ margin: 0 }}>
                <Link to={`/salas/${r.id}`}>{r.name}</Link>
              </h3>
              <p className="muted">
                {r.topic ? `${r.topic} · ` : ""}desde el {formatDate(r.createdAt)}
                {r.slowModeSeconds > 0 && ` · modo lento: ${r.slowModeSeconds} s`}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}

function NewRoom() {
  const api = useApi();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [touched, setTouched] = useState(false);
  const create = useAction(async () => {
    const r = await api.createRoom({ name: name.trim(), ...(topic.trim() ? { topic: topic.trim() } : {}) });
    navigate(`/salas/${r.id}`);
    return r;
  });
  const nameError = touched && name.trim().length < 3 ? "Poné un nombre de al menos 3 letras." : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (name.trim().length >= 3) void create.run();
  };
  return (
    <form className="card stack" onSubmit={submit} noValidate aria-labelledby="nueva-sala">
      <h2 id="nueva-sala">Nueva sala</h2>
      <div className="grid-2">
        <Field label="Nombre" error={nameError}>
          {(p) => <input {...p} className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo: Debate de esta noche" />}
        </Field>
        <Field label="Tema (opcional)">{(p) => <input {...p} className="input" maxLength={120} value={topic} onChange={(e) => setTopic(e.target.value)} />}</Field>
      </div>
      <div className="row">
        <button className="btn" type="submit" disabled={create.pending}>
          {create.pending ? "Creando…" : "Crear sala"}
        </button>
      </div>
      <ErrorAlert error={create.error} />
    </form>
  );
}

/** Una sala: quién está, la conversación en vivo (anunciada sin robar el foco), chequeos y moderación. */
export function TeamRoomPage() {
  const api = useApi();
  const { me, can } = useSession();
  const { id = "" } = useParams();
  const details = useAsync(() => (can("team_rooms") ? api.room(id) : Promise.reject(new Error("sin plan"))), [api, id]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [present, setPresent] = useState<string[]>([]);
  const [archived, setArchived] = useState(false);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (!details.data) return;
    return api.watchRoom(
      id,
      (e) => {
        setLost(false);
        if (e.type === "history") setMessages(e.messages);
        if (e.type === "message") setMessages((m) => [...m.filter((x) => x.id !== e.message.id), e.message]);
        if (e.type === "deleted") setMessages((m) => m.filter((x) => x.id !== e.messageId));
        if (e.type === "presence" && e.userIds) setPresent(e.userIds);
        if (e.type === "closed") setArchived(true);
      },
      () => setLost(true),
    );
  }, [api, id, details.data]);

  if (!can("team_rooms")) return <NotAvailable />;
  if (details.loading) return <div className="page"><Spinner /></div>;
  if (!details.data) {
    return (
      <Page title="Sala">
        <ErrorAlert error={details.error} />
        <p>
          <Link to="/salas">Volver a las salas</Link>
        </p>
      </Page>
    );
  }
  const d = details.data;
  const nameOf = (userId?: string) => (userId === me?.id ? "Vos" : (d.members.find((m) => m.id === userId)?.name ?? "Alguien del equipo"));
  const here = present.map((u) => nameOf(u));

  return (
    <Page title={d.room.name} lead={d.room.topic}>
      <nav aria-label="Salas" className="row">
        <Link to="/salas">← Todas las salas</Link>
      </nav>
      <p className="muted" aria-live="polite">
        {here.length ? `En la sala: ${here.join(", ")}.` : "Conectando…"}
        {d.room.slowModeSeconds > 0 && ` Modo lento: un mensaje cada ${d.room.slowModeSeconds} s por persona.`}
        {lost && !archived && " Reconectando…"}
      </p>
      {archived && (
        <Notice title="La sala se archivó">
          <p>
            Ya no se puede escribir. <Link to="/salas">Volver a las salas</Link>
          </p>
        </Notice>
      )}

      <section aria-labelledby="conversacion" className="card stack">
        <h2 id="conversacion">Conversación</h2>
        {messages.length === 0 && <p className="muted">Nadie escribió todavía.</p>}
        <ol className="plain-list stack" aria-live="polite" aria-relevant="additions">
          {messages.map((m) => (
            <MessageItem key={m.id} m={m} author={nameOf(m.authorId)} canDelete={!archived && (m.authorId === me?.id || d.canModerate)} />
          ))}
        </ol>
        {!archived && <TeamPostForm roomId={d.room.id} canCheck={d.canModerate} slow={d.room.slowModeSeconds} />}
      </section>

      {!archived && (d.canModerate || d.room.createdBy === me?.id) && <ArchiveRoom d={d} onArchived={() => setArchived(true)} />}
    </Page>
  );
}

function MessageItem({ m, author, canDelete }: { m: RoomMessage; author: string; canDelete: boolean }) {
  const api = useApi();
  const del = useAction(() => api.deleteRoomMessage(m.id));
  const check = m.flags.includes("verificacion");
  return (
    <li className={check ? "finding finding--fact" : undefined}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <span>
          <strong>{author}</strong> <span className="muted">· {formatDateTime(m.at)}</span>
          {check && <span className="badge badge--fact" style={{ marginInlineStart: "var(--space-2)" }}>Chequeo</span>}
          {m.flags.includes("sin_fuente") && <span className="badge badge--smoke" style={{ marginInlineStart: "var(--space-2)" }}>Cifra sin fuente</span>}
        </span>
        {canDelete && (
          <button className="btn btn--ghost btn--small" type="button" onClick={() => void del.run()} disabled={del.pending} aria-label={`Borrar el mensaje de ${author}`}>
            Borrar
          </button>
        )}
      </div>
      <p style={{ margin: "var(--space-1) 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        <Linked text={m.text} />
      </p>
      <ErrorAlert error={del.error} />
    </li>
  );
}

function TeamPostForm({ roomId, canCheck, slow }: { roomId: string; canCheck: boolean; slow: number }) {
  const api = useApi();
  const [text, setText] = useState("");
  const [asCheck, setAsCheck] = useState(false);
  const post = useAction(async () => {
    await api.postToRoom(roomId, text.trim(), asCheck ? "verificacion" : undefined);
    setText("");
    setAsCheck(false);
    return true;
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) void post.run();
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Tu mensaje" hint={`Si das una cifra, sumá el link de la fuente.${slow > 0 ? ` Modo lento: ${slow} s entre mensajes.` : ""}`}>
        {(p) => <textarea {...p} className="textarea" style={{ minHeight: "4.5rem" }} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />}
      </Field>
      {canCheck && (
        <label className="row">
          <input type="checkbox" checked={asCheck} onChange={(e) => setAsCheck(e.target.checked)} />
          Publicar como chequeo del equipo (se destaca y no espera el modo lento)
        </label>
      )}
      <ErrorAlert error={post.error} />
      <div className="row">
        <button className="btn" type="submit" disabled={post.pending || !text.trim()}>
          Enviar
        </button>
      </div>
    </form>
  );
}

function ArchiveRoom({ d, onArchived }: { d: TeamRoomDetails; onArchived: () => void }) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const archive = useAction(async () => {
    await api.archiveRoom(d.room.id);
    onArchived();
  });
  return (
    <section className="card stack" aria-labelledby="archivar">
      <h2 id="archivar">Archivar la sala</h2>
      <p className="muted">Deja de aparecer en la lista y ya no se puede escribir.</p>
      {confirming ? (
        <div className="row" role="group" aria-label="Confirmar el archivo">
          <button className="btn btn--danger" type="button" onClick={() => void archive.run()} disabled={archive.pending}>
            {archive.pending ? "Archivando…" : "Sí, archivar"}
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => setConfirming(false)}>
            No
          </button>
        </div>
      ) : (
        <div className="row">
          <button className="btn btn--secondary" type="button" onClick={() => setConfirming(true)}>
            Archivar
          </button>
        </div>
      )}
      <ErrorAlert error={archive.error} />
    </section>
  );
}


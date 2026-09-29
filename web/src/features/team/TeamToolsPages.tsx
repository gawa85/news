import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { Campaign, ReplyDraft } from "../../api/types";
import { formatDate, formatDateTime, formatNumber } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Linked, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { TopicSuggestions, useTopics } from "../shared/catalog";

// ---------------------------------------------------------------- Aulas

/**
 * AULAS (docentes de una escuela con el plan Educación): crear un aula, compartir el código y ver el
 * progreso de cada estudiante POR APODO (nunca teléfonos ni mails: hay menores).
 */
export function ClassroomsPage() {
  const api = useApi();
  const { has, can } = useSession();
  // Hace falta el rol (docente) y el plan de la escuela (Educación, gratis).
  const teacher = has("learning:teach") && can("learning_mode");
  const list = useAsync(() => (teacher ? api.classrooms() : Promise.resolve([])), [api, teacher]);
  const [open, setOpen] = useState<string>();
  const [name, setName] = useState("");
  const [ranking, setRanking] = useState(false);
  const create = useAction(async () => {
    await api.createClassroom(name.trim(), ranking);
    setName("");
    await list.reload();
    return true;
  });
  if (!teacher) {
    return (
      <Page title="Aulas" lead="El juego «¿Esto es humo?» para toda la clase, con el progreso de cada estudiante.">
        <div className="card">
          <p>
            {has("learning:teach")
              ? "Las aulas vienen con el plan Educación, gratis para escuelas: tu organización tiene otro plan. "
              : "Las aulas son para docentes de escuelas registradas (el plan Educación es gratis). "}
            Escribinos desde <Link to="/ayuda">Ayuda</Link> y registramos tu escuela.
          </p>
        </div>
      </Page>
    );
  }
  return (
    <Page title="Aulas" lead="Creá un aula, compartí el código con tus estudiantes y seguí cómo aprenden a reconocer el humo. Sólo ves apodos: nunca teléfonos ni mails.">
      <form
        className="card stack"
        noValidate
        aria-labelledby="nueva-aula"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (name.trim()) void create.run();
        }}
      >
        <h2 id="nueva-aula">Nueva aula</h2>
        <Field label="Nombre" hint="Por ejemplo: 3° B — Lengua">{(p) => <input {...p} className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <label className="row">
          <input type="checkbox" checked={ranking} onChange={(e) => setRanking(e.target.checked)} /> Mostrar un ranking (los 10 con más aciertos). Si no, cada uno ve sólo lo suyo.
        </label>
        <div className="row">
          <button className="btn" type="submit" disabled={create.pending || !name.trim()}>
            Crear aula
          </button>
        </div>
        <ErrorAlert error={create.error} />
      </form>
      {list.loading && !list.data && <Spinner />}
      <ErrorAlert error={list.error} />
      {list.data?.length === 0 && <p className="muted">Todavía no creaste aulas.</p>}
      <ul className="plain-list stack">
        {list.data?.map((c) => (
          <li key={c.id} className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{c.name}</h2>
              <button className="btn btn--secondary btn--small" type="button" onClick={() => setOpen(open === c.id ? undefined : c.id)} aria-expanded={open === c.id}>
                {open === c.id ? "Cerrar" : "Ver progreso"}
              </button>
            </div>
            <p style={{ margin: 0 }}>
              Código para sumarse: <strong className="mono" style={{ fontSize: "1.25rem" }}>{c.joinCode}</strong> · {c.students} {c.students === 1 ? "estudiante" : "estudiantes"}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Los estudiantes entran en «¿Esto es humo?» de la web, o mandan <span className="mono">/aula {c.joinCode} TuApodo</span> por WhatsApp o Telegram.
            </p>
            {open === c.id && <ClassroomDetail id={c.id} onArchived={() => void list.reload()} />}
          </li>
        ))}
      </ul>
    </Page>
  );
}

function ClassroomDetail({ id, onArchived }: { id: string; onArchived: () => void }) {
  const api = useApi();
  const report = useAsync(() => api.classroomReport(id), [api, id]);
  const [confirming, setConfirming] = useState(false);
  const archive = useAction(async () => {
    await api.archiveClassroom(id);
    onArchived();
  });
  const r = report.data;
  return (
    <div className="stack">
      {report.loading && <Spinner />}
      <ErrorAlert error={report.error} />
      {r && r.students.length === 0 && <p className="muted">Todavía no se sumó nadie.</p>}
      {r && r.students.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption>Progreso por estudiante</caption>
            <thead>
              <tr>
                <th scope="col">Apodo</th>
                <th scope="col">Respondidas</th>
                <th scope="col">Aciertos</th>
              </tr>
            </thead>
            <tbody>
              {r.students.map((s) => (
                <tr key={s.alias}>
                  <th scope="row">{s.alias}</th>
                  <td>{s.answered}</td>
                  <td>{s.accuracy === null ? "—" : `${s.correct} (${Math.round(s.accuracy * 100)} %)`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r && r.hardest.length > 0 && (
        <p>
          <strong>Lo que más les cuesta:</strong> {r.hardest.slice(0, 3).map((h) => `${h.type} (${h.misses} errores)`).join(", ")}. Buen tema para la próxima clase.
        </p>
      )}
      {r?.leaderboard && r.leaderboard.length > 0 && <p>Ranking: {r.leaderboard.join(", ")}</p>}
      {confirming ? (
        <div className="row" role="group" aria-label="Confirmar que archivás el aula">
          <button className="btn btn--danger btn--small" type="button" onClick={() => void archive.run()} disabled={archive.pending}>
            Sí, archivar
          </button>
          <button className="btn btn--ghost btn--small" type="button" onClick={() => setConfirming(false)}>
            No
          </button>
        </div>
      ) : (
        <div className="row">
          <button className="btn btn--ghost btn--small" type="button" onClick={() => setConfirming(true)}>
            Archivar (fin del año)
          </button>
        </div>
      )}
      {confirming && <p role="status">El código deja de servir; lo que aprendió cada estudiante queda en su cuenta.</p>}
      <ErrorAlert error={archive.error} />
    </div>
  );
}

// ---------------------------------------------------------------- Respuestas públicas

const REPLY_STATUS: Record<ReplyDraft["status"], [string, string]> = {
  pending_review: ["Esperando aprobación", "badge--smoke"],
  published: ["Publicada", "badge--fact"],
  rejected: ["Rechazada", "badge--neutral"],
  failed: ["No se pudo publicar", "badge--danger"],
};

/**
 * RESPUESTAS PÚBLICAS: lo que el equipo propuso publicar en foros y páginas, y la moderación.
 * Una respuesta pública la aprueba otra persona de la organización antes de salir.
 */
export function RepliesPage() {
  const api = useApi();
  const { has } = useSession();
  const moderates = has("replies:moderate");
  const mine = useAsync(() => api.myReplies(), [api]);
  const pending = useAsync(() => (moderates ? api.pendingReplies() : Promise.resolve([])), [api, moderates]);
  return (
    <Page title="Respuestas públicas" lead="Respuestas con fuentes en foros y páginas donde circula humo. Salen identificadas y, si las propone alguien sin permiso de moderar, las aprueba otra persona del equipo.">
      {moderates && (
        <section className="card stack" aria-labelledby="por-aprobar">
          <h2 id="por-aprobar">Por aprobar</h2>
          {pending.loading && <Spinner />}
          <ErrorAlert error={pending.error} />
          {pending.data?.length === 0 && <p className="muted">No hay respuestas esperando.</p>}
          <ul className="plain-list stack">
            {pending.data?.map((d) => (
              <PendingReply key={d.id} d={d} onDone={() => pending.setData((pending.data ?? []).filter((x) => x.id !== d.id))} />
            ))}
          </ul>
        </section>
      )}
      <section className="card stack" aria-labelledby="mias">
        <h2 id="mias">Las que propusiste</h2>
        {mine.loading && <Spinner />}
        <ErrorAlert error={mine.error} />
        {mine.data?.length === 0 && <p className="muted">Todavía no propusiste respuestas. Se piden desde el análisis de un mensaje o por la API.</p>}
        <ul className="plain-list stack">
          {mine.data?.map((d) => (
            <li key={d.id} className="card card--flat">
              <ReplySummary d={d} />
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}

function ReplySummary({ d }: { d: ReplyDraft }) {
  return (
    <>
      <p style={{ margin: 0 }}>
        <span className={`badge ${REPLY_STATUS[d.status][1]}`}>{REPLY_STATUS[d.status][0]}</span> <strong>{d.content.title}</strong>
      </p>
      <p className="muted" style={{ margin: "var(--space-1) 0 0" }}>
        En {d.target.destination} · {formatDateTime(d.createdAt)}
        {d.topic && ` · ${d.topic}`}
        {d.publishedUrl && (
          <>
            {" · "}
            <a href={d.publishedUrl} target="_blank" rel="noopener noreferrer">
              ver publicada
            </a>
          </>
        )}
        {d.error && ` · ${d.error}`}
      </p>
    </>
  );
}

function PendingReply({ d, onDone }: { d: ReplyDraft; onDone: () => void }) {
  const api = useApi();
  const review = useAction(async (approve: boolean) => {
    await api.reviewReply(d.id, approve);
    onDone();
  });
  return (
    <li className="card card--flat stack">
      <ReplySummary d={d} />
      {d.content.summary && (
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          <Linked text={d.content.summary} />
        </p>
      )}
      {d.content.links.length > 0 && (
        <ul>
          {d.content.links.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button className="btn btn--small" type="button" onClick={() => void review.run(true)} disabled={review.pending} aria-label={`Aprobar y publicar: ${d.content.title}`}>
          Aprobar y publicar
        </button>
        <button className="btn btn--ghost btn--small" type="button" onClick={() => void review.run(false)} disabled={review.pending} aria-label={`Rechazar: ${d.content.title}`}>
          Rechazar
        </button>
      </div>
      <ErrorAlert error={review.error} />
    </li>
  );
}

// ---------------------------------------------------------------- Campañas

const CAMPAIGN_STATUS: Record<Campaign["status"], [string, string]> = {
  pending_review: ["Esperando revisión", "badge--smoke"],
  approved: ["Aprobada", "badge--fact"],
  rejected: ["Rechazada", "badge--neutral"],
  running: ["En curso", "badge--fact"],
  finished: ["Terminada", "badge--neutral"],
};

/**
 * CAMPAÑAS PARA CONTRARRESTAR HUMO: se contrarresta una afirmación (nunca una persona), con fuentes,
 * identificando siempre quién emite, y sólo por canales propios y audiencias que aceptaron.
 * La aprueba otra persona; en veda electoral no sale contenido político.
 */
export function CampaignsPage() {
  const api = useApi();
  const { me, has } = useSession();
  const list = useAsync(() => api.campaigns(), [api]);
  const canCreate = has("campaigns:manage");
  const canReview = has("campaigns:review");
  const d = list.data;
  return (
    <Page title="Campañas" lead="Cuando una cadena crece, respondé con datos: una campaña identificada, con fuentes, por tus canales y con quienes aceptaron sumarse.">
      {!canCreate && !canReview && (
        <div className="card">
          <p>Las campañas las crean y revisan equipos con plan Profesional o superior y el rol que corresponde.</p>
        </div>
      )}
      {canCreate && d && <NewCampaign channels={d.channels} onCreated={() => void list.reload()} />}
      {list.loading && !d && <Spinner />}
      <ErrorAlert error={list.error} />
      {d && d.campaigns.length === 0 && (canCreate || canReview) && <p className="muted">Todavía no hay campañas.</p>}
      <ul className="plain-list stack">
        {d?.campaigns.map((c) => (
          <CampaignItem key={c.id} c={c} mine={c.ownerId === me?.id} canReview={canReview} canLaunch={canCreate} onChange={() => void list.reload()} />
        ))}
      </ul>
    </Page>
  );
}

function CampaignItem({ c, mine, canReview, canLaunch, onChange }: { c: Campaign; mine: boolean; canReview: boolean; canLaunch: boolean; onChange: () => void }) {
  const api = useApi();
  const [note, setNote] = useState("");
  const [showReport, setShowReport] = useState(false);
  const review = useAction(async (approve: boolean) => {
    await api.reviewCampaign(c.id, approve, note.trim());
    onChange();
  });
  const launch = useAction(async () => {
    await api.launchCampaign(c.id);
    onChange();
  });
  const report = useAsync(() => (showReport ? api.campaignReport(c.id) : Promise.resolve(undefined)), [api, c.id, showReport]);
  return (
    <li className="card stack">
      <p style={{ margin: 0 }}>
        <span className={`badge ${CAMPAIGN_STATUS[c.status][1]}`}>{CAMPAIGN_STATUS[c.status][0]}</span> {c.political && <span className="badge badge--neutral">Contenido político</span>}{" "}
        <span className="muted">
          · de {c.sponsor} · {formatDate(c.createdAt)}
        </span>
      </p>
      <h2 style={{ margin: 0 }}>{c.message.title}</h2>
      <p style={{ margin: 0 }}>
        Contrarresta: «{c.claim}»
      </p>
      {c.message.summary && <p className="muted" style={{ margin: 0 }}>{c.message.summary}</p>}
      <p className="muted" style={{ margin: 0 }}>
        Fuentes:{" "}
        {c.message.links.map((l, i) => (
          <span key={l.url}>
            {i > 0 && ", "}
            <a href={l.url} target="_blank" rel="noopener noreferrer">
              {l.label}
            </a>
          </span>
        ))}
      </p>
      {c.riskNotes?.length ? (
        <Notice title="Para revisar con cuidado">
          <p>{c.riskNotes.join(" · ")}</p>
        </Notice>
      ) : null}
      {c.reviewNote && <p className="muted" style={{ margin: 0 }}>Revisión: {c.reviewNote}</p>}

      {c.status === "pending_review" && canReview && !mine && (
        <div className="stack">
          <Field label="Nota de revisión" hint="Al menos 10 caracteres: qué miraste (fuentes, tono, que no apunte a personas).">
            {(p) => <input {...p} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <div className="row">
            <button className="btn btn--small" type="button" onClick={() => void review.run(true)} disabled={review.pending || note.trim().length < 10}>
              Aprobar
            </button>
            <button className="btn btn--ghost btn--small" type="button" onClick={() => void review.run(false)} disabled={review.pending || note.trim().length < 10}>
              Rechazar
            </button>
          </div>
        </div>
      )}
      {c.status === "pending_review" && mine && <p className="muted">La tiene que aprobar otra persona del equipo.</p>}
      {c.status === "approved" && canLaunch && (
        <div className="row">
          <button className="btn" type="button" onClick={() => void launch.run()} disabled={launch.pending}>
            {launch.pending ? "Lanzando…" : "Lanzar"}
          </button>
        </div>
      )}
      {(c.status === "running" || c.status === "finished") && (
        <div className="row">
          <button className="btn btn--secondary btn--small" type="button" onClick={() => setShowReport(!showReport)} aria-expanded={showReport}>
            {showReport ? "Ocultar resultados" : "Ver resultados"}
          </button>
        </div>
      )}
      {showReport && report.data && (
        <dl className="stats">
          <div>
            <dt>Llegó a</dt>
            <dd>{formatNumber(report.data.reach)}</dd>
          </div>
          <div>
            <dt>Clics en las fuentes</dt>
            <dd>{formatNumber(report.data.clicks)}</dd>
          </div>
          <div>
            <dt>Aliados que se sumaron</dt>
            <dd>{formatNumber(report.data.alliesAccepted)}</dd>
          </div>
          {report.data.narrative?.change !== null && report.data.narrative?.change !== undefined && (
            <div>
              <dt>La cadena, después</dt>
              <dd>
                {report.data.narrative.change > 0 ? "+" : ""}
                {Math.round(report.data.narrative.change * 100)} %
              </dd>
            </div>
          )}
        </dl>
      )}
      <ErrorAlert error={review.error ?? launch.error ?? report.error} />
    </li>
  );
}

function NewCampaign({ channels, onCreated }: { channels: { id: string; label: string }[]; onCreated: () => void }) {
  const api = useApi();
  const topics = useTopics();
  const [claim, setClaim] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [sources, setSources] = useState("");
  const [topic, setTopic] = useState("");
  const [chosen, setChosen] = useState<string[]>(channels.slice(0, 1).map((c) => c.id));
  const [political, setPolitical] = useState(false);
  // Mientras se escribe, un link puede estar a medias ("https://"): sólo cuentan los que se pueden leer.
  const links = sources
    .split(/\n/)
    .map((x) => x.trim())
    .flatMap((url) => {
      try {
        const u = new URL(url);
        return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? [{ label: u.hostname.replace(/^www\./, ""), url }] : [];
      } catch {
        return [];
      }
    });
  const create = useAction(async () => {
    await api.createCampaign({ claim: claim.trim(), title: title.trim(), summary: summary.trim(), links, channelIds: chosen, topic: topic.trim() || undefined, political });
    setClaim("");
    setTitle("");
    setSummary("");
    setSources("");
    onCreated();
    return true;
  });
  const ready = claim.trim().length >= 15 && title.trim() && summary.trim() && links.length > 0 && chosen.length > 0;
  return (
    <details className="card">
      <summary>Nueva campaña</summary>
      <form
        className="stack"
        noValidate
        style={{ marginTop: "var(--space-4)" }}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void create.run();
        }}
      >
        <Field label="Qué afirmación contrarresta" hint="La afirmación, nunca una persona. Al menos 15 caracteres.">
          {(p) => <input {...p} className="input" value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="Por ejemplo: «el gas sube 300% mañana»" />}
        </Field>
        <Field label="Título del mensaje">{(p) => <input {...p} className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Qué dicen los datos">{(p) => <textarea {...p} className="textarea" maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} />}</Field>
        <Field label="Fuentes (links, uno por línea)" hint="Al menos una. Se muestran en cada pieza.">
          {(p) => <textarea {...p} className="textarea" style={{ minHeight: "4rem" }} value={sources} onChange={(e) => setSources(e.target.value)} />}
        </Field>
        <Field label="Tema">{(p) => <input {...p} className="input" list="temas-campana" value={topic} onChange={(e) => setTopic(e.target.value)} />}</Field>
        <TopicSuggestions id="temas-campana" topics={topics} />
        <fieldset>
          <legend className="field__label">Por dónde</legend>
          <div className="row">
            {channels.map((c) => (
              <label key={c.id} className="row">
                <input type="checkbox" checked={chosen.includes(c.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, c.id] : chosen.filter((x) => x !== c.id))} /> {c.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="row">
          <input type="checkbox" checked={political} onChange={(e) => setPolitical(e.target.checked)} /> Es contenido político (no sale durante una veda electoral)
        </label>
        <div className="row">
          <button className="btn" type="submit" disabled={create.pending || !ready}>
            Mandar a revisión
          </button>
        </div>
        <ErrorAlert error={create.error} />
        {create.result && (
          <Notice tone="ok">
            <p>Enviada. La tiene que aprobar otra persona del equipo antes de salir.</p>
          </Notice>
        )}
      </form>
    </details>
  );
}

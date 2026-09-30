import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { RuleSet, SourceConnection } from "../../api/types";
import { formatDate, formatDateTime } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { TopicSuggestions, useOutlets, useTopics } from "../shared/catalog";
import { DirectoryPicker } from "../shared/DirectoryPicker";

const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- Mis fuentes

/**
 * MIS FUENTES: conectar un buzón de mail o feeds de noticias; lo nuevo se analiza solo y te avisamos.
 * El buzón se lee (nunca se escribe ni se borra nada) y la contraseña se guarda cifrada.
 */
export function SourcesPage() {
  const api = useApi();
  const list = useAsync(() => api.sources(), [api]);
  const d = list.data;
  return (
    <Page title="Mis fuentes" lead="Conectá tu buzón de mail o los feeds que seguís: lo nuevo se analiza solo y te avisamos si hay humo.">
      {list.loading && !d && <Spinner />}
      <ErrorAlert error={list.error} />
      {d && !d.available && (
        <div className="card">
          <p>
            Conectar fuentes viene con el plan Personal o superior. <Link to="/planes">Ver planes</Link>
          </p>
        </div>
      )}
      {d?.available && <SuggestedSources onAdded={() => void list.reload()} />}
      {d?.available && (d.limit === null || d.connections.length < d.limit) && <ConnectSource onConnected={() => void list.reload()} />}
      {d?.available && d.limit !== null && d.connections.length >= d.limit && (
        <Notice title="Llegaste al máximo de tu plan">
          <p>
            Tu plan permite {d.limit} fuente(s). Desconectá una o <Link to="/planes">mirá los planes</Link>.
          </p>
        </Notice>
      )}
      {d && d.connections.length > 0 && (
        <section className="card stack" aria-labelledby="conectadas">
          <h2 id="conectadas">Conectadas</h2>
          <ul className="plain-list stack">
            {d.connections.map((c) => (
              <SourceItem key={c.id} c={c} onGone={() => list.setData({ ...d, connections: d.connections.filter((x) => x.id !== c.id) })} />
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}

function SourceItem({ c, onGone }: { c: SourceConnection; onGone: () => void }) {
  const api = useApi();
  const off = useAction(async () => {
    await api.disconnectSource(c.id);
    onGone();
  });
  return (
    <li className="card card--flat stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          <span className="badge badge--neutral">{c.type === "email" ? "Buzón" : "Feed"}</span> <strong>{c.name}</strong>{" "}
          <span className="muted mono">{c.type === "email" ? `${c.config.user ?? ""} @ ${c.config.host ?? ""}` : c.config.url}</span>
        </span>
        <button className="btn btn--ghost btn--small" type="button" onClick={() => void off.run()} disabled={off.pending} aria-label={`Desconectar ${c.name}`}>
          Desconectar
        </button>
      </div>
      {c.lastError ? (
        <p role="status" style={{ margin: 0 }}>
          <span className="badge badge--danger">No anda</span> Desde el {formatDateTime(c.lastError.at)}: {c.lastError.message}
        </p>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          {c.lastSyncAt ? `Leída por última vez: ${formatDateTime(c.lastSyncAt)}` : `Conectada el ${formatDate(c.createdAt)}; la primera lectura es en unos minutos.`}
        </p>
      )}
      <ErrorAlert error={off.error} />
    </li>
  );
}

function ConnectSource({ onConnected }: { onConnected: () => void }) {
  const api = useApi();
  const [type, setType] = useState<"rss" | "email">("rss");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [folder, setFolder] = useState("INBOX");
  const connect = useAction(async () => {
    await api.connectSource(
      type === "rss"
        ? { type, name: name.trim() || url.trim(), config: { url: url.trim() } }
        : { type, name: name.trim() || user.trim(), config: { host: host.trim(), user: user.trim(), port: "993", folder: folder.trim() || "INBOX" }, secret: password },
    );
    setUrl("");
    setPassword("");
    setName("");
    onConnected();
    return true;
  });
  const ready = type === "rss" ? /^https?:\/\/\S+$/i.test(url.trim()) : !!host.trim() && !!user.trim() && !!password;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) void connect.run();
  };
  return (
    <form className="card stack" onSubmit={submit} noValidate aria-labelledby="conectar">
      <h2 id="conectar">Conectar una fuente</h2>
      <fieldset>
        <legend className="field__label">¿Qué querés conectar?</legend>
        <div className="row">
          <label className="row">
            <input type="radio" name="tipo" checked={type === "rss"} onChange={() => setType("rss")} /> Un feed de noticias (RSS)
          </label>
          <label className="row">
            <input type="radio" name="tipo" checked={type === "email"} onChange={() => setType("email")} /> Mi buzón de mail
          </label>
        </div>
      </fieldset>
      {type === "rss" ? (
        <Field label="Dirección del feed" hint="Suele terminar en /rss, /feed o .xml.">
          {(p) => <input {...p} className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />}
        </Field>
      ) : (
        <>
          <Notice>
            <p>
              Sólo leemos (nunca escribimos, movemos ni borramos). Usá una <strong>contraseña de aplicación</strong>, no la de siempre: Gmail, Outlook y Yahoo te dejan crear una solo para esto y la podés revocar cuando quieras.
            </p>
          </Notice>
          <div className="grid-2">
            <Field label="Servidor IMAP" hint="Gmail: imap.gmail.com · Outlook: outlook.office365.com">
              {(p) => <input {...p} className="input" autoComplete="off" value={host} onChange={(e) => setHost(e.target.value)} />}
            </Field>
            <Field label="Usuario (tu mail)">{(p) => <input {...p} className="input" type="email" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} />}</Field>
            <Field label="Contraseña de aplicación">{(p) => <input {...p} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <Field label="Carpeta">{(p) => <input {...p} className="input" value={folder} onChange={(e) => setFolder(e.target.value)} />}</Field>
          </div>
        </>
      )}
      <Field label="Nombre (para reconocerla)">{(p) => <input {...p} className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <div className="row">
        <button className="btn" type="submit" disabled={connect.pending || !ready}>
          {connect.pending ? "Probando la conexión…" : "Conectar"}
        </button>
      </div>
      <p className="muted">Antes de guardarla probamos que ande.</p>
      <ErrorAlert error={connect.error} title="No se pudo conectar" />
      {connect.result && !connect.pending && (
        <Notice tone="ok">
          <p>Conectada. La primera lectura es en unos minutos.</p>
        </Notice>
      )}
    </form>
  );
}

// ---------------------------------------------------------------- Mis reglas de fuentes

/** MIS REGLAS DE FUENTES: medios a excluir siempre, o sólo los que elijo, al comparar noticias. */
export function RulesPage() {
  const api = useApi();
  const list = useAsync(() => api.ruleSets(), [api]);
  const d = list.data;
  return (
    <Page title="Mis reglas de fuentes" lead="Qué medios usar cuando comparás noticias: excluí los que no querés o limitá a los que elegís.">
      {list.loading && !d && <Spinner />}
      <ErrorAlert error={list.error} />
      {d && (d.canEditPersonal || d.canEditOrganization) && <NewRuleSet canPersonal={d.canEditPersonal} canOrg={d.canEditOrganization} onSaved={() => void list.reload()} />}
      {d && !d.canEditPersonal && !d.canEditOrganization && (
        <div className="card">
          <p>
            Guardar reglas viene con tu plan o te lo da quien administra tu organización. <Link to="/planes">Ver planes</Link>
          </p>
        </div>
      )}
      {d && (
        <>
          <RuleList title="Tuyas" sets={d.personal} canEdit={d.canEditPersonal} onGone={() => void list.reload()} empty="No tenés reglas guardadas." />
          {(d.organization.length > 0 || d.canEditOrganization) && (
            <RuleList title="De tu organización (se aplican a todo el equipo)" sets={d.organization} canEdit={d.canEditOrganization} onGone={() => void list.reload()} empty="Tu organización no tiene reglas." />
          )}
        </>
      )}
    </Page>
  );
}

function RuleList({ title, sets, canEdit, onGone, empty }: { title: string; sets: RuleSet[]; canEdit: boolean; onGone: () => void; empty: string }) {
  const api = useApi();
  const off = useAction(async (id: string) => {
    await api.deactivateRuleSet(id);
    onGone();
  });
  const id = title.replace(/\W+/g, "-").toLowerCase();
  return (
    <section className="card stack" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {sets.length === 0 && <p className="muted">{empty}</p>}
      <ul className="plain-list stack">
        {sets.map((s) => (
          <li key={s.id} className="card card--flat">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{s.name}</strong>
              {canEdit && (
                <button className="btn btn--ghost btn--small" type="button" onClick={() => void off.run(s.id)} disabled={off.pending} aria-label={`Quitar la regla ${s.name}`}>
                  Quitar
                </button>
              )}
            </div>
            {s.urlRules.exclude?.length ? <p style={{ margin: "var(--space-1) 0 0" }}>Nunca: {s.urlRules.exclude.join(", ")}</p> : null}
            {s.urlRules.onlyFrom?.length ? <p style={{ margin: "var(--space-1) 0 0" }}>Sólo: {s.urlRules.onlyFrom.join(", ")}</p> : null}
          </li>
        ))}
      </ul>
      <ErrorAlert error={off.error} />
    </section>
  );
}

function NewRuleSet({ canPersonal, canOrg, onSaved }: { canPersonal: boolean; canOrg: boolean; onSaved: () => void }) {
  const api = useApi();
  const [scope, setScope] = useState<"user" | "organization">(canPersonal ? "user" : "organization");
  const [name, setName] = useState("");
  const [exclude, setExclude] = useState("");
  const [only, setOnly] = useState("");
  const save = useAction(async () => {
    await api.saveRuleSet({ scope, name: name.trim(), urlRules: { exclude: lines(exclude), onlyFrom: lines(only) } });
    setName("");
    setExclude("");
    setOnly("");
    onSaved();
    return true;
  });
  const ready = name.trim().length >= 2 && (lines(exclude).length > 0 || lines(only).length > 0);
  return (
    <form
      className="card stack"
      noValidate
      aria-labelledby="nueva-regla"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void save.run();
      }}
    >
      <h2 id="nueva-regla">Nueva regla</h2>
      {canPersonal && canOrg && (
        <Field label="Para quién">
          {(p) => (
            <select {...p} className="select" value={scope} onChange={(e) => setScope(e.target.value as "user" | "organization")}>
              <option value="user">Sólo para mí</option>
              <option value="organization">Para toda mi organización</option>
            </select>
          )}
        </Field>
      )}
      <Field label="Nombre">{(p) => <input {...p} className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Por ejemplo: sin sitios de opinión" />}</Field>
      <div className="grid-2">
        <Field label="No usar nunca" hint="Un dominio o sección por línea: diario.example o diario.example/opinion">
          {(p) => <textarea {...p} className="textarea" style={{ minHeight: "5rem" }} value={exclude} onChange={(e) => setExclude(e.target.value)} />}
        </Field>
        <Field label="Usar sólo estos (opcional)" hint="Si completás esto, sólo se buscan notas de acá.">
          {(p) => <textarea {...p} className="textarea" style={{ minHeight: "5rem" }} value={only} onChange={(e) => setOnly(e.target.value)} />}
        </Field>
      </div>
      <div className="row">
        <button className="btn" type="submit" disabled={save.pending || !ready}>
          Guardar
        </button>
      </div>
      <ErrorAlert error={save.error} />
    </form>
  );
}

// ---------------------------------------------------------------- Derecho a réplica

const STATUS: Record<string, [string, string]> = {
  submitted: ["En revisión", "badge--neutral"],
  accepted: ["Aceptada", "badge--fact"],
  partially_accepted: ["Aceptada en parte", "badge--fact"],
  rejected: ["Rechazada", "badge--danger"],
};

/**
 * DERECHO A RÉPLICA (representantes acreditados de un medio): pedir que se revise una evaluación.
 * La resuelve otra persona del equipo de verificación; si se acepta, se publica la fe de erratas.
 */
export function RebuttalPage() {
  const api = useApi();
  const { me } = useSession();
  const { nameOf } = useOutlets();
  const topics = useTopics();
  const outlets = me?.representsOutletIds ?? [];
  const mine = useAsync(() => (outlets.length ? api.myRebuttals() : Promise.resolve([])), [api, outlets.length]);
  const [outletId, setOutletId] = useState(outlets[0] ?? "");
  const [topic, setTopic] = useState("");
  const [statement, setStatement] = useState("");
  const [evidence, setEvidence] = useState("");
  const submit = useAction(async () => {
    await api.submitRebuttal({ outletId, topic: topic.trim(), statement: statement.trim(), evidenceUrls: lines(evidence) });
    setStatement("");
    setEvidence("");
    void mine.reload();
    return true;
  });

  if (!outlets.length) {
    return (
      <Page title="Derecho a réplica" lead="Los medios pueden pedir que revisemos una evaluación.">
        <div className="card">
          <p>
            Para presentar una réplica tenés que estar acreditado como representante del medio. Escribinos desde <Link to="/ayuda">Ayuda</Link> con los datos del medio y te acreditamos.
          </p>
        </div>
      </Page>
    );
  }
  const short = statement.trim().length < 50;
  return (
    <Page title="Derecho a réplica" lead="Si creés que evaluamos mal a tu medio, contanos por qué y con qué pruebas. La resuelve otra persona del equipo de verificación y la respuesta es pública.">
      <form
        className="card stack"
        noValidate
        aria-labelledby="nueva-replica"
        onSubmit={(e) => {
          e.preventDefault();
          if (!short && topic.trim()) void submit.run();
        }}
      >
        <h2 id="nueva-replica">Nueva réplica</h2>
        <div className="grid-2">
          <Field label="Medio">
            {(p) => (
              <select {...p} className="select" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                {outlets.map((o) => (
                  <option key={o} value={o}>
                    {nameOf(o)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Tema de la evaluación">{(p) => <input {...p} className="input" list="temas-replica" value={topic} onChange={(e) => setTopic(e.target.value)} />}</Field>
        </div>
        <TopicSuggestions id="temas-replica" topics={topics} />
        <Field label="Qué está mal y por qué" hint={`Al menos 50 caracteres (llevás ${statement.trim().length}).`}>
          {(p) => <textarea {...p} className="textarea" maxLength={4000} value={statement} onChange={(e) => setStatement(e.target.value)} />}
        </Field>
        <Field label="Pruebas (links, uno por línea)" hint="Documentos, audios, notas originales. Hasta 10.">
          {(p) => <textarea {...p} className="textarea" style={{ minHeight: "4rem" }} value={evidence} onChange={(e) => setEvidence(e.target.value)} />}
        </Field>
        <div className="row">
          <button className="btn" type="submit" disabled={submit.pending || short || !topic.trim()}>
            {submit.pending ? "Enviando…" : "Presentar réplica"}
          </button>
        </div>
        <ErrorAlert error={submit.error} />
        {submit.result && !submit.pending && (
          <Notice tone="ok">
            <p>Recibida. Te avisamos cuando se resuelva.</p>
          </Notice>
        )}
      </form>
      <section className="card stack" aria-labelledby="mis-replicas">
        <h2 id="mis-replicas">Réplicas presentadas</h2>
        {mine.loading && <Spinner />}
        {mine.data?.length === 0 && <p className="muted">Todavía no presentaste réplicas.</p>}
        <ul className="plain-list stack">
          {mine.data?.map((r) => (
            <li key={r.id} className="card card--flat">
              <p style={{ margin: 0 }}>
                <span className={`badge ${STATUS[r.status]![1]}`}>{STATUS[r.status]![0]}</span> {nameOf(r.outletId)} · {formatDate(r.createdAt)}
              </p>
              <p style={{ margin: "var(--space-1) 0 0" }}>«{r.statement}»</p>
              {r.resolution && <p className="muted" style={{ margin: "var(--space-1) 0 0" }}>Respuesta: {r.resolution.note}</p>}
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}

/** FUENTES SUGERIDAS: medios y organismos conocidos, para agregarlos sin escribir la dirección de su feed. */
function SuggestedSources({ onAdded }: { onAdded: () => void }) {
  const api = useApi();
  const dir = useAsync(() => api.sourceDirectory(), [api]);
  const [pickerKey, setPickerKey] = useState(0);
  const add = useAction(async (ids: string[]) => {
    const r = await api.addFromDirectory(ids);
    await dir.reload();
    setPickerKey((k) => k + 1);
    onAdded();
    return r;
  });
  const d = dir.data;
  const room = d && d.limit !== null ? Math.max(0, d.limit - d.used) : null;
  const failed = add.result?.results.filter((r) => !r.ok) ?? [];
  const ok = add.result?.results.filter((r) => r.ok) ?? [];
  return (
    <section className="card stack" aria-labelledby="sugeridas">
      <h2 id="sugeridas" style={{ margin: 0 }}>
        Fuentes sugeridas
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        Medios, agencias, verificadores y organismos conocidos, con su feed ya comprobado. Marcá las que quieras y agregalas de una vez. Si la que buscás no está, agregala
        abajo con su dirección.
      </p>
      {dir.loading && !d && <Spinner />}
      <ErrorAlert error={dir.error} />
      {d && room === 0 && (
        <Notice title="No te quedan lugares">
          <p>
            Tu plan permite {d.limit} fuente(s). Desconectá una o <Link to="/planes">mirá los planes</Link>.
          </p>
        </Notice>
      )}
      {d && room !== 0 && (
        <DirectoryPicker
          key={pickerKey}
          entries={d.entries}
          isAdded={(e) => !!d.entries.find((x) => x.id === e.id)?.connected}
          addedLabel="Ya la tenés"
          room={room}
          submitLabel="Agregar las elegidas"
          pending={add.pending}
          onSubmit={(ids) => void add.run(ids)}
        />
      )}
      <ErrorAlert error={add.error} />
      {add.result && (
        <div role="status" className="stack">
          {ok.length > 0 && (
            <Notice tone="ok">
              <p>Agregadas: {ok.map((r) => r.name).join(", ")}. La primera lectura es en unos minutos.</p>
            </Notice>
          )}
          {failed.length > 0 && (
            <Notice title="Algunas no se pudieron agregar">
              <ul>
                {failed.map((r) => (
                  <li key={r.id}>
                    {r.name}: {r.error}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}
    </section>
  );
}

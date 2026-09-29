import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { Digest, Preferences, ResponseFormat } from "../../api/types";
import { formatDate, formatPrice, limitText } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { TopicSuggestions, useTopicNames } from "../shared/catalog";
import { ApiKeysSection } from "./ApiKeysSection";
import { ReferralsSection } from "../commerce/CommercePages";
import { WebhooksSection } from "./WebhooksSection";
import { ChannelLinker } from "../onboarding/ChannelLinker";

const CHANNELS: Record<string, string> = { email: "Mail", whatsapp: "WhatsApp", telegram: "Telegram", sms: "SMS", web: "Web" };

/** MI CUENTA: plan y uso, preferencias, temas, sesión y mis datos. */
export function AccountPage() {
  const { me, has, refresh } = useSession();
  if (!me) return null;
  return (
    <Page title="Mi cuenta">
      <nav aria-label="Más de tu cuenta" className="row">
        <Link className="btn btn--secondary btn--small" to="/historial">
          Historial
        </Link>
        <Link className="btn btn--secondary btn--small" to="/organizacion">
          {me.organizationId ? "Mi organización" : "Crear una organización"}
        </Link>
        {has("learning:teach") && (
          <Link className="btn btn--secondary btn--small" to="/aulas">
            Aulas
          </Link>
        )}
        {(has("replies:publish_public") || has("replies:moderate")) && (
          <Link className="btn btn--secondary btn--small" to="/respuestas">
            Respuestas públicas
          </Link>
        )}
        {(has("campaigns:manage") || has("campaigns:review")) && (
          <Link className="btn btn--secondary btn--small" to="/campanas">
            Campañas
          </Link>
        )}
        {has("users:manage_org") && me.plan.features.includes("white_label") && (
          <Link className="btn btn--secondary btn--small" to="/marca">
            Marca propia
          </Link>
        )}
        <Link className="btn btn--secondary btn--small" to="/estadisticas">
          Estadísticas
        </Link>
        <Link className="btn btn--secondary btn--small" to="/fuentes">
          Mis fuentes
        </Link>
        <Link className="btn btn--secondary btn--small" to="/reglas">
          Mis reglas de fuentes
        </Link>
        {(me.representsOutletIds?.length ?? 0) > 0 && (
          <Link className="btn btn--secondary btn--small" to="/replica">
            Derecho a réplica
          </Link>
        )}
        <Link className="btn btn--secondary btn--small" to="/alertas">
          Alertas
        </Link>
        <Link className="btn btn--secondary btn--small" to="/archivo">
          Archivo de notas
        </Link>
        <Link className="btn btn--secondary btn--small" to="/jugar">
          ¿Esto es humo? (juego)
        </Link>
        <Link className="btn btn--secondary btn--small" to="/ayuda">
          Ayuda
        </Link>
      </nav>
      <div className="grid-2">
        <section className="card" aria-labelledby="datos">
          <h2 id="datos">Tus datos</h2>
          <p>
            <strong>{me.name}</strong>
          </p>
          <ul>
            {me.channels.map((c) => (
              <li key={`${c.type}:${c.address}`}>
                {CHANNELS[c.type] ?? c.type}: <span className="mono">{c.address}</span> {c.verified && <span className="badge badge--fact">verificado</span>}
              </li>
            ))}
          </ul>
          <details>
            <summary>Vincular WhatsApp o Telegram</summary>
            <ChannelLinker onChecked={() => void refresh()} />
          </details>
        </section>
        <section className="card" aria-labelledby="plan">
          <h2 id="plan">Tu plan: {me.plan.name}</h2>
          {me.plan.price && <p className="muted">{formatPrice(me.plan.price)}</p>}
          {me.subscription?.planChange && (
            <Notice title={`Tu plan cambia el ${formatDate(me.subscription.planChange.effectiveAt)}`}>
              <p>
                Pasás a {me.subscription.planChange.toPlanName}. Conservás lo que ya pagaste; desde el próximo cobro pagás {formatPrice(me.subscription.planChange.price)}.
                {me.subscription.planChange.message && ` ${me.subscription.planChange.message}`}
              </p>
              <p>
                {me.subscription.managedByOrganization
                  ? "Si no les sirve, quien administra la organización puede darla de baja sin costo antes de esa fecha."
                  : "Si no te sirve, podés darte de baja sin costo antes de esa fecha (más abajo)."}
              </p>
            </Notice>
          )}
          <ul>
            <li>
              Análisis hoy: {me.usage.analyses} de {limitText(me.plan.limits.analysesPerDay, "por día")}
            </li>
            <li>
              Comparaciones este mes: {me.usage.comparisons} de {limitText(me.plan.limits.comparisonsPerMonth, "por mes")}
            </li>
          </ul>
          <div className="row">
            <Link className="btn btn--secondary" to="/planes">
              Cambiar de plan
            </Link>
          </div>
          {me.plan.price && me.subscription && !me.subscription.managedByOrganization && <CancelSubscription />}
        </section>
      </div>
      <PreferencesForm />
      <FollowedTopics />
      <ReferralsSection />
      <ApiKeysSection />
      <WebhooksSection />
      <SessionAndData />
    </Page>
  );
}

/**
 * Cancelar sin trampas: se dice cuándo termina, se confirma una sola vez y se puede deshacer.
 * Sigue con su plan hasta el fin del período que ya pagó; después, plan Gratis.
 */
function CancelSubscription() {
  const api = useApi();
  const { me, refresh } = useSession();
  const [confirming, setConfirming] = useState(false);
  const cancel = useAction(async () => {
    await api.cancelSubscription();
    await refresh();
    setConfirming(false);
    return true;
  });
  const resume = useAction(async () => {
    await api.resumeSubscription();
    await refresh();
    return true;
  });
  const sub = me!.subscription!;
  const until = formatDate(sub.currentPeriodEnd);
  if (sub.cancelAtPeriodEnd) {
    return (
      <div className="stack" style={{ marginTop: "var(--space-4)" }}>
        <Notice title="Cancelaste tu plan">
          <p>
            Seguís con {me!.plan.name} hasta el {until}. Después pasás al plan Gratis y no se te cobra más.
          </p>
          <button type="button" className="btn btn--small" onClick={() => void resume.run()} disabled={resume.pending}>
            Seguir con {me!.plan.name}
          </button>
        </Notice>
        <ErrorAlert error={resume.error} />
      </div>
    );
  }
  return (
    <div className="stack" style={{ marginTop: "var(--space-4)" }}>
      <p className="muted">Se renueva el {until}.</p>
      {!confirming ? (
        <button type="button" className="btn btn--ghost" onClick={() => setConfirming(true)}>
          Cancelar mi plan
        </button>
      ) : (
        <div className="card card--flat stack" role="group" aria-label="Confirmar la cancelación">
          <p>
            Seguís con {me!.plan.name} hasta el <strong>{until}</strong> (ya está pagado). Después pasás al plan Gratis. Lo podés deshacer hasta esa fecha.
          </p>
          <div className="row">
            <button type="button" className="btn btn--danger" onClick={() => void cancel.run()} disabled={cancel.pending}>
              Sí, cancelar
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => setConfirming(false)}>
              No, seguir
            </button>
          </div>
          <ErrorAlert error={cancel.error} />
        </div>
      )}
    </div>
  );
}

function PreferencesForm() {
  const api = useApi();
  const { can } = useSession();
  const prefs = useAsync(() => api.preferences(), [api]);
  const [draft, setDraft] = useState<Preferences>();
  const save = useAction(async (p: Preferences) => {
    const saved = await api.updatePreferences({ responseFormat: p.responseFormat, language: p.language, digest: p.digest, audioReplies: p.audioReplies, quietHours: p.quietHours });
    prefs.setData(saved);
    return true;
  });
  useEffect(() => {
    if (prefs.data) setDraft(prefs.data);
  }, [prefs.data]);

  if (prefs.loading && !draft) return <Spinner />;
  if (!draft) return <ErrorAlert error={prefs.error} />;
  const locked = (k: keyof Preferences) => draft.source[k] === "locked";
  const set = (p: Partial<Preferences>) => {
    save.reset();
    setDraft({ ...draft, ...p });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save.run(draft);
  };

  return (
    <section className="card" aria-labelledby="prefs">
      <h2 id="prefs">Cómo te respondemos</h2>
      <p className="muted">Vale para la web, WhatsApp, Telegram y mail.</p>
      <form className="stack" onSubmit={submit}>
        <fieldset disabled={locked("responseFormat")}>
          <legend>Formato de las respuestas {locked("responseFormat") && "(lo fija tu organización)"}</legend>
          {(
            [
              ["detailed", "Detallado", "Todo el análisis."],
              ["short", "Corto", "Lo principal, para leer rápido."],
              ["easy_read", "Lectura fácil", "Frases cortas y palabras simples."],
            ] as [ResponseFormat, string, string][]
          ).map(([v, label, hint]) => (
            <label key={v} className="checkbox">
              <input type="radio" name="formato" value={v} checked={draft.responseFormat === v} onChange={() => set({ responseFormat: v })} />
              <span>
                <strong>{label}</strong> <span className="muted">— {hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid-2">
          <Field label="Idioma" hint={locked("language") ? "Lo fija tu organización." : undefined}>
            {(p) => (
              <select {...p} className="select" value={draft.language} disabled={locked("language")} onChange={(e) => set({ language: e.target.value })}>
                <option value="es">Español</option>
                <option value="pt">Português</option>
                <option value="en">English</option>
              </select>
            )}
          </Field>
          <Field label="Resumen de novedades" hint={!can("daily_digest") ? "El diario viene con el plan Personal; en el gratis se manda el semanal." : undefined}>
            {(p) => (
              <select {...p} className="select" value={draft.digest} disabled={locked("digest")} onChange={(e) => set({ digest: e.target.value as Digest })}>
                <option value="off">No quiero</option>
                <option value="weekly">Semanal</option>
                <option value="daily">Diario</option>
              </select>
            )}
          </Field>
        </div>

        <label className="checkbox">
          <input type="checkbox" checked={draft.audioReplies} disabled={locked("audioReplies")} onChange={(e) => set({ audioReplies: e.target.checked })} />
          <span>
            Además del texto, mandame las respuestas en audio (WhatsApp y Telegram)
            {!can("audio_replies") && <span className="muted"> — viene con el plan Personal</span>}
          </span>
        </label>

        <fieldset disabled={locked("quietHours")}>
          <legend>Horario de silencio</legend>
          <label className="checkbox">
            <input type="checkbox" checked={!!draft.quietHours} onChange={(e) => set({ quietHours: e.target.checked ? { from: "22:00", to: "08:00", utcOffsetMinutes: -180 } : null })} />
            <span>No me mandes avisos a la noche (te llegan cuando termina)</span>
          </label>
          {draft.quietHours && (
            <div className="grid-2">
              <Field label="Desde">{(p) => <input {...p} className="input" type="time" value={draft.quietHours!.from} onChange={(e) => set({ quietHours: { ...draft.quietHours!, from: e.target.value } })} />}</Field>
              <Field label="Hasta">{(p) => <input {...p} className="input" type="time" value={draft.quietHours!.to} onChange={(e) => set({ quietHours: { ...draft.quietHours!, to: e.target.value } })} />}</Field>
            </div>
          )}
        </fieldset>

        <ErrorAlert error={save.error} />
        {save.result && <Notice tone="ok">Listo, guardamos tus preferencias.</Notice>}
        <div className="row">
          <button className="btn" type="submit" disabled={save.pending}>
            {save.pending ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </section>
  );
}

function FollowedTopics() {
  const api = useApi();
  const { names, all } = useTopicNames();
  const prefs = useAsync(() => api.preferences(), [api]);
  const [topic, setTopic] = useState("");
  const follow = useAction(async (t: string) => {
    await api.follow(t);
    setTopic("");
    await prefs.reload();
    return true;
  });
  const unfollow = useAction(async (t: string) => {
    await api.unfollow(t);
    await prefs.reload();
    return true;
  });
  const followed = prefs.data?.followedTopics ?? [];
  return (
    <section className="card" aria-labelledby="temas-seguidos">
      <h2 id="temas-seguidos">Temas que seguís</h2>
      <p className="muted">Te avisamos las novedades de estos temas en tu resumen.</p>
      {followed.length === 0 ? (
        <p>Todavía no seguís ningún tema.</p>
      ) : (
        <ul className="row" style={{ listStyle: "none", padding: 0 }}>
          {followed.map((id) => (
            <li key={id} className="badge badge--neutral">
              {names.get(id) ?? id}
              <button type="button" className="btn btn--ghost btn--small" onClick={() => void unfollow.run(id)} aria-label={`Dejar de seguir ${names.get(id) ?? id}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (topic.trim()) void follow.run(topic.trim());
        }}
      >
        <Field label="Seguir un tema">{(p) => <input {...p} className="input" list="temas-todos" value={topic} onChange={(e) => setTopic(e.target.value)} />}</Field>
        <TopicSuggestions id="temas-todos" topics={all} />
        <button className="btn btn--secondary" type="submit" disabled={follow.pending || !topic.trim()} style={{ alignSelf: "end" }}>
          Seguir
        </button>
      </form>
      <ErrorAlert error={follow.error ?? unfollow.error} />
    </section>
  );
}

const CONFIRM = "BORRAR MIS DATOS";

function SessionAndData() {
  const api = useApi();
  const { logout } = useSession();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState("");
  const out = useAction(async (everywhere: boolean) => {
    await logout(everywhere);
    navigate("/");
    return true;
  });
  const remove = useAction(async () => {
    await api.deleteAccount(confirm);
    await logout();
    navigate("/");
    return true;
  });
  return (
    <div className="grid-2">
      <section className="card stack" aria-labelledby="sesion">
        <h2 id="sesion">Sesión</h2>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={() => void out.run(false)} disabled={out.pending}>
            Salir
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void out.run(true)} disabled={out.pending}>
            Salir en todos los dispositivos
          </button>
        </div>
        <ErrorAlert error={out.error} />
      </section>
      <section className="card stack" aria-labelledby="mis-datos">
        <h2 id="mis-datos">Tus datos personales</h2>
        <p>
          <a href={api.myDataUrl()} download>
            Bajar todos mis datos
          </a>{" "}
          <span className="muted">(archivo JSON)</span>
        </p>
        <details>
          <summary>Borrar mi cuenta</summary>
          <form
            className="stack"
            style={{ marginTop: "var(--space-3)" }}
            onSubmit={(e) => {
              e.preventDefault();
              void remove.run();
            }}
          >
            <p>Se borran tus análisis, preferencias, reglas y alertas. No se puede deshacer.</p>
            <Field label={`Para confirmar, escribí ${CONFIRM}`}>{(p) => <input {...p} className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />}</Field>
            <ErrorAlert error={remove.error} />
            <button className="btn btn--danger" type="submit" disabled={confirm !== CONFIRM || remove.pending}>
              Borrar mi cuenta
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}

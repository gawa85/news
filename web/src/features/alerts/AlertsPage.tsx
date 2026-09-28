import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { AlertRule, AlertTrigger } from "../../api/types";
import { ALERT_TRIGGERS, CHANNEL_NAMES, formatDate } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { TopicSuggestions, useOutlets, useTopics } from "../shared/catalog";

/** ALERTAS: te avisamos por tu canal cuando pasa algo en un tema que seguís. */
export function AlertsPage() {
  const api = useApi();
  const { me, can } = useSession();
  const list = useAsync(() => api.alerts(), [api]);

  if (!me) return null;
  if (!can("alerts")) {
    return (
      <Page title="Alertas" lead="Te avisamos por WhatsApp, Telegram o mail cuando pasa algo en un tema que seguís.">
        <div className="card">
          <p>Las alertas vienen con el plan Personal o superior.</p>
          <Link className="btn" to="/planes">
            Ver planes
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Alertas" lead="Te avisamos por tu canal cuando pasa algo en un tema que seguís. Revisamos cada hora.">
      <NewAlert onCreated={(a) => list.setData([a, ...(list.data ?? [])])} />
      <section className="card stack" aria-labelledby="mis-alertas">
        <h2 id="mis-alertas">Tus alertas</h2>
        {list.loading && <Spinner />}
        <ErrorAlert error={list.error} />
        {list.data && list.data.length === 0 && <p className="muted">Todavía no tenés alertas.</p>}
        {list.data && list.data.length > 0 && (
          <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
            {list.data.map((a) => (
              <AlertItem key={a.id} alert={a} onOff={() => list.setData(list.data!.filter((x) => x.id !== a.id))} />
            ))}
          </ul>
        )}
      </section>
    </Page>
  );
}

function AlertItem({ alert, onOff }: { alert: AlertRule; onOff: () => void }) {
  const api = useApi();
  const { nameOf } = useOutlets();
  const off = useAction(async () => {
    await api.deactivateAlert(alert.id);
    onOff();
  });
  return (
    <li className="card card--flat">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <p>
            <strong>{alert.topic}</strong> · {ALERT_TRIGGERS[alert.trigger].label}
            {alert.outletId && ` de ${nameOf(alert.outletId)}`}
          </p>
          <p className="muted">
            Por {CHANNEL_NAMES[alert.channel] ?? alert.channel} · desde el {formatDate(alert.createdAt)}
            {alert.lastCheckedAt && ` · revisada el ${formatDate(alert.lastCheckedAt)}`}
          </p>
        </div>
        <button className="btn btn--ghost btn--small" type="button" onClick={() => void off.run()} disabled={off.pending} aria-label={`Apagar la alerta de ${alert.topic}`}>
          {off.pending ? "Apagando…" : "Apagar"}
        </button>
      </div>
      <ErrorAlert error={off.error} />
    </li>
  );
}

function NewAlert({ onCreated }: { onCreated: (a: AlertRule) => void }) {
  const api = useApi();
  const { me, can } = useSession();
  const topics = useTopics();
  const { list: outlets } = useOutlets();
  const channels = (me?.channels ?? []).filter((c) => c.verified && c.type !== "web").map((c) => c.type);
  const [topic, setTopic] = useState("");
  const [trigger, setTrigger] = useState<AlertTrigger>("new_coverage");
  const [channel, setChannel] = useState(channels[0] ?? "");
  const [outletId, setOutletId] = useState("");
  const [touched, setTouched] = useState(false);
  const create = useAction(async () => {
    const a = await api.createAlert({ topic: topic.trim(), trigger, channel, ...(trigger === "credibility_change" ? { outletId } : {}) });
    onCreated(a);
    setTopic("");
    setTouched(false);
    return a;
  });
  const needsOutlet = trigger === "credibility_change";
  const triggers = (Object.keys(ALERT_TRIGGERS) as AlertTrigger[]).filter((t) => t !== "credibility_change" || can("credibility_meter"));

  if (!channels.length) {
    return (
      <Notice title="Primero verificá un canal">
        <p>Las alertas llegan por mail, WhatsApp o Telegram. Verificá alguno escribiéndonos por ahí.</p>
      </Notice>
    );
  }

  const topicError = touched && !topic.trim() ? "Escribí un tema." : undefined;
  const outletError = touched && needsOutlet && !outletId ? "Elegí un medio." : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (topic.trim() && (!needsOutlet || outletId)) void create.run();
  };

  return (
    <form className="card stack" onSubmit={submit} noValidate aria-labelledby="nueva-alerta">
      <h2 id="nueva-alerta">Nueva alerta</h2>
      <div className="grid-2">
        <Field label="Tema" error={topicError}>
          {(p) => <input {...p} className="input" list="temas-alerta" required value={topic} onChange={(e) => setTopic(e.target.value)} />}
        </Field>
        <Field label="Avisame por">
          {(p) => (
            <select {...p} className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
              {channels.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_NAMES[c] ?? c}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <TopicSuggestions id="temas-alerta" topics={topics} />
      <fieldset className="stack">
        <legend className="field__label">¿Cuándo te avisamos?</legend>
        {triggers.map((t) => (
          <label key={t} className="row" style={{ alignItems: "flex-start" }}>
            <input type="radio" name="trigger" value={t} checked={trigger === t} onChange={() => setTrigger(t)} />
            <span>
              <strong>{ALERT_TRIGGERS[t].label}.</strong> <span className="muted">{ALERT_TRIGGERS[t].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {needsOutlet && (
        <Field label="Medio" error={outletError}>
          {(p) => (
            <select {...p} className="select" required value={outletId} onChange={(e) => setOutletId(e.target.value)}>
              <option value="">Elegí un medio…</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <div className="row">
        <button className="btn" type="submit" disabled={create.pending}>
          {create.pending ? "Creando…" : "Crear alerta"}
        </button>
      </div>
      <ErrorAlert error={create.error} />
      {create.result && !create.pending && (
        <Notice tone="ok">
          <p>Listo: te vamos a avisar sobre «{create.result.topic}».</p>
        </Notice>
      )}
    </form>
  );
}

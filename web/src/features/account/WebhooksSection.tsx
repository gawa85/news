import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { DeliveryResult, Webhook } from "../../api/types";
import { formatDateTime, WEBHOOK_EVENT_LABELS } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

/**
 * WEBHOOKS: avisos firmados a otro sistema (la redacción, un Slack propio, un CRM) cuando pasa algo.
 * El secreto de firma se muestra una sola vez; después se puede mandar una prueba y ver cómo respondió.
 */
export function WebhooksSection() {
  const api = useApi();
  const { can } = useSession();
  const allowed = can("webhooks");
  const data = useAsync(() => (allowed ? api.webhooks() : Promise.resolve(undefined)), [api, allowed]);
  const [secret, setSecret] = useState<string>();

  if (!allowed) {
    return (
      <section className="card" aria-labelledby="webhooks">
        <h2 id="webhooks">Webhooks</h2>
        <p>
          Avisos automáticos a tus sistemas cuando termina un análisis, salta una alerta o se publica una corrección. Vienen con el plan Profesional. <Link to="/planes">Ver planes</Link>
        </p>
      </section>
    );
  }

  const list = data.data?.webhooks ?? [];
  return (
    <section className="card stack" aria-labelledby="webhooks">
      <h2 id="webhooks">Webhooks</h2>
      <p className="muted">
        Te mandamos un POST con JSON firmado (<span className="mono">x-sinhumo-signature</span>: HMAC-SHA256 de «timestamp.cuerpo»). Verificá la firma y rechazá los avisos viejos.
      </p>
      {data.loading && <Spinner />}
      <ErrorAlert error={data.error} />
      {secret && <SecretShown secret={secret} onDone={() => setSecret(undefined)} />}
      {data.data?.available && !secret && (
        <CreateWebhook
          events={data.data.events}
          onCreated={(w, s) => {
            setSecret(s);
            data.setData({ ...data.data!, webhooks: [w, ...list] });
          }}
        />
      )}
      {data.data && (
        <>
          <h3>Tus webhooks</h3>
          {list.length === 0 ? (
            <p className="muted">Todavía no configuraste ninguno.</p>
          ) : (
            <ul className="plain-list stack">
              {list.map((w) => (
                <WebhookItem key={w.id} w={w} onRemoved={() => data.setData({ ...data.data!, webhooks: list.filter((x) => x.id !== w.id) })} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function CreateWebhook({ events, onCreated }: { events: string[]; onCreated: (w: Webhook, secret: string) => void }) {
  const api = useApi();
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string[]>(["analysis.completed"]);
  const [touched, setTouched] = useState(false);
  const create = useAction(async () => {
    const r = await api.createWebhook(url.trim(), chosen);
    onCreated(r.webhook, r.signingSecret);
  });
  const urlError = touched && !/^https:\/\/\S+$/i.test(url.trim()) ? "Tiene que ser una dirección https." : undefined;
  const eventsError = touched && !chosen.length ? "Elegí al menos un evento." : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (/^https:\/\/\S+$/i.test(url.trim()) && chosen.length) void create.run();
  };
  return (
    <form className="card card--flat stack" onSubmit={submit} noValidate aria-labelledby="nuevo-webhook">
      <h3 id="nuevo-webhook">Nuevo webhook</h3>
      <Field label="Dirección (https)" error={urlError}>
        {(p) => <input {...p} className="input" type="url" inputMode="url" placeholder="https://tu-sistema.example/sinhumo" value={url} onChange={(e) => setUrl(e.target.value)} />}
      </Field>
      <fieldset aria-describedby={eventsError ? "eventos-error" : undefined}>
        <legend className="field__label">Avisame cuando…</legend>
        <div className="grid-2">
          {events.map((ev) => (
            <label key={ev} className="row">
              <input type="checkbox" checked={chosen.includes(ev)} onChange={(e) => setChosen(e.target.checked ? [...chosen, ev] : chosen.filter((x) => x !== ev))} />
              {WEBHOOK_EVENT_LABELS[ev] ?? ev}
            </label>
          ))}
        </div>
        {eventsError && (
          <span className="field__error" id="eventos-error">
            {eventsError}
          </span>
        )}
      </fieldset>
      <div className="row">
        <button className="btn" type="submit" disabled={create.pending}>
          {create.pending ? "Guardando…" : "Crear webhook"}
        </button>
      </div>
      <ErrorAlert error={create.error} />
    </form>
  );
}

function SecretShown({ secret, onDone }: { secret: string; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  return (
    <div ref={box} tabIndex={-1}>
      <Notice tone="ok" title="Guardá el secreto de firma">
        <p>Es la única vez que lo vas a ver. Con él tu sistema comprueba que el aviso es nuestro.</p>
        <code className="secret" aria-label="Secreto de firma del webhook">
          {secret}
        </code>
        <div className="row" style={{ marginTop: "var(--space-3)" }}>
          <button className="btn btn--ghost btn--small" type="button" onClick={onDone}>
            Ya lo guardé
          </button>
        </div>
      </Notice>
    </div>
  );
}

function WebhookItem({ w, onRemoved }: { w: Webhook; onRemoved: () => void }) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [last, setLast] = useState<DeliveryResult | undefined>(w.lastDelivery);
  const test = useAction(async () => {
    const r = await api.testWebhook(w.id);
    setLast(r);
    return r;
  });
  const remove = useAction(async () => {
    await api.removeWebhook(w.id);
    onRemoved();
  });
  const lastText = !last ? "Todavía no se mandó nada." : last.ok ? `Último envío: respondió bien (HTTP ${last.status}).` : `Último envío: falló (${last.error ?? `HTTP ${last.status}`}).`;
  return (
    <li className="card card--flat stack">
      <p className="mono" style={{ overflowWrap: "anywhere", margin: 0 }}>
        {w.url}
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {w.events.map((e) => WEBHOOK_EVENT_LABELS[e] ?? e).join(" · ")}
      </p>
      <p role="status" style={{ margin: 0 }}>
        {last && <span className={`badge ${last.ok ? "badge--fact" : "badge--danger"}`}>{last.ok ? "OK" : "Falla"}</span>} {lastText}
        {w.lastDelivery && last === w.lastDelivery && <span className="muted"> ({formatDateTime(w.lastDelivery.at)})</span>}
      </p>
      <div className="row">
        <button className="btn btn--secondary btn--small" type="button" onClick={() => void test.run()} disabled={test.pending}>
          {test.pending ? "Probando…" : "Mandar una prueba"}
        </button>
        {confirming ? (
          <span className="row" role="group" aria-label="Confirmar que borrás el webhook">
            <button className="btn btn--danger btn--small" type="button" onClick={() => void remove.run()} disabled={remove.pending}>
              Sí, borrar
            </button>
            <button className="btn btn--ghost btn--small" type="button" onClick={() => setConfirming(false)}>
              No
            </button>
          </span>
        ) : (
          <button className="btn btn--ghost btn--small" type="button" onClick={() => setConfirming(true)} aria-label={`Borrar el webhook ${w.url}`}>
            Borrar
          </button>
        )}
      </div>
      <ErrorAlert error={test.error ?? remove.error} />
    </li>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { ApiKey } from "../../api/types";
import { formatDate, SCOPE_LABELS } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

/** Por defecto, lo que usa un bot: analizar. El resto se elige. */
const DEFAULT_SCOPES = ["content:analyze", "smoke:analyze"];

/**
 * CLAVES DE API para bots, agentes de IA y clientes MCP.
 * La clave completa se muestra UNA vez (guardamos sólo su huella); después se ve el comienzo para reconocerla.
 */
export function ApiKeysSection() {
  const api = useApi();
  const { can } = useSession();
  const data = useAsync(() => api.apiKeys(), [api]);
  const [created, setCreated] = useState<string>();

  if (!can("api_access")) {
    return (
      <section className="card" aria-labelledby="api">
        <h2 id="api">API y agentes de IA</h2>
        <p>
          Conectá Sin Humo a tus bots, a tu agente de IA o a un cliente MCP. Viene con el plan Profesional. <Link to="/planes">Ver planes</Link>
        </p>
      </section>
    );
  }

  const keys = data.data?.keys ?? [];
  const active = keys.filter((k) => !k.revoked);
  return (
    <section className="card stack" aria-labelledby="api">
      <h2 id="api">API y agentes de IA</h2>
      <p className="muted">
        Usá la clave en el encabezado <span className="mono">Authorization: Bearer …</span> o en tu cliente MCP. Cada clave tiene sólo los permisos que le des.
      </p>
      {data.loading && <Spinner />}
      <ErrorAlert error={data.error} />
      {created && <NewKeyShown plaintext={created} onDone={() => setCreated(undefined)} />}
      {data.data?.available && !created && (
        <CreateKey
          scopes={data.data.scopes}
          onCreated={(plaintext, key) => {
            setCreated(plaintext);
            data.setData({ ...data.data!, keys: [key, ...keys] });
          }}
        />
      )}
      {data.data && (
        <>
          <h3>Tus claves</h3>
          {active.length === 0 ? (
            <p className="muted">No tenés claves activas.</p>
          ) : (
            <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
              {active.map((k) => (
                <KeyItem key={k.id} k={k} onRevoked={() => data.setData({ ...data.data!, keys: keys.map((x) => (x.id === k.id ? { ...x, revoked: true } : x)) })} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function CreateKey({ scopes, onCreated }: { scopes: string[]; onCreated: (plaintext: string, key: ApiKey) => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>(DEFAULT_SCOPES.filter((s) => scopes.includes(s)));
  const [touched, setTouched] = useState(false);
  const options = scopes.filter((s) => SCOPE_LABELS[s]);
  const create = useAction(async () => {
    const r = await api.createApiKey(name.trim(), chosen);
    onCreated(r.plaintext, r.key);
  });
  const nameError = touched && !name.trim() ? "Poné un nombre para reconocerla (por ejemplo, «bot de la redacción»)." : undefined;
  const scopeError = touched && !chosen.length ? "Elegí al menos un permiso." : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (name.trim() && chosen.length) void create.run();
  };
  return (
    <form className="card card--flat stack" onSubmit={submit} noValidate aria-labelledby="nueva-clave">
      <h3 id="nueva-clave">Nueva clave</h3>
      <Field label="Nombre" error={nameError}>
        {(p) => <input {...p} className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <fieldset aria-describedby={scopeError ? "permisos-error" : undefined}>
        <legend className="field__label">Qué puede hacer</legend>
        <div className="grid-2">
          {options.map((s) => (
            <label key={s} className="row">
              <input type="checkbox" checked={chosen.includes(s)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s] : chosen.filter((x) => x !== s))} />
              {SCOPE_LABELS[s]}
            </label>
          ))}
        </div>
        {scopeError && (
          <span className="field__error" id="permisos-error">
            {scopeError}
          </span>
        )}
      </fieldset>
      <div className="row">
        <button className="btn" type="submit" disabled={create.pending}>
          {create.pending ? "Creando…" : "Crear clave"}
        </button>
      </div>
      <ErrorAlert error={create.error} />
    </form>
  );
}

function NewKeyShown({ plaintext, onDone }: { plaintext: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus(), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div ref={box} tabIndex={-1}>
      <Notice tone="ok" title="Copiá tu clave ahora">
        <p>Es la única vez que la vas a ver. Si la perdés, revocala y creá otra.</p>
        <code className="secret" aria-label="Tu nueva clave de API">
          {plaintext}
        </code>
        <div className="row" style={{ marginTop: "var(--space-3)" }}>
          <button className="btn btn--secondary btn--small" type="button" onClick={() => void copy()}>
            {copied ? "Copiada" : "Copiar"}
          </button>
          <button className="btn btn--ghost btn--small" type="button" onClick={onDone}>
            Ya la guardé
          </button>
        </div>
        <p className="visually-hidden" aria-live="polite">
          {copied ? "Clave copiada al portapapeles." : ""}
        </p>
      </Notice>
    </div>
  );
}

function KeyItem({ k, onRevoked }: { k: ApiKey; onRevoked: () => void }) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const revoke = useAction(async () => {
    await api.revokeApiKey(k.id);
    onRevoked();
  });
  return (
    <li className="card card--flat">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <p>
            <strong>{k.name}</strong> <span className="mono muted">{k.prefix}…</span>
          </p>
          <p className="muted">
            Creada el {formatDate(k.createdAt)} · {k.lastUsedAt ? `último uso: ${formatDate(k.lastUsedAt)}` : "sin usar todavía"}
          </p>
          <p className="muted">{k.scopes.map((s) => SCOPE_LABELS[s] ?? s).join(" · ")}</p>
        </div>
        {confirming ? (
          <div className="row">
            <button className="btn btn--danger btn--small" type="button" onClick={() => void revoke.run()} disabled={revoke.pending}>
              {revoke.pending ? "Revocando…" : "Sí, revocar"}
            </button>
            <button className="btn btn--ghost btn--small" type="button" onClick={() => setConfirming(false)}>
              No
            </button>
          </div>
        ) : (
          <button className="btn btn--ghost btn--small" type="button" onClick={() => setConfirming(true)} aria-label={`Revocar la clave ${k.name}`}>
            Revocar
          </button>
        )}
      </div>
      {confirming && <p role="status">Lo que use esta clave deja de funcionar enseguida.</p>}
      <ErrorAlert error={revoke.error} />
    </li>
  );
}

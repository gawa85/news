import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { Parameter, ParameterValue } from "../../api/backofficeTypes";
import { formatDateTime } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

/** PARÁMETROS: números y opciones del negocio que se cambian sin tocar el código (cada cambio pide un motivo). */
export function ParametersPage() {
  const api = useBackoffice();
  const list = useAsync(() => api.parameters(), [api]);
  const [q, setQ] = useState("");
  const items = (list.data ?? []).filter((p) => !q.trim() || `${p.key} ${p.description}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Page title="Parámetros" lead="Cada cambio queda registrado con quién, cuándo y por qué.">
      <Field label="Buscar">{(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
      {list.loading && !list.data && <Spinner />}
      <ErrorAlert error={list.error} />
      <ul className="plain-list stack">
        {items.map((p) => (
          <ParameterItem key={p.key} p={p} onSaved={() => void list.reload()} />
        ))}
      </ul>
    </Page>
  );
}

function ParameterItem({ p, onSaved }: { p: Parameter; onSaved: () => void }) {
  const api = useBackoffice();
  const [value, setValue] = useState<ParameterValue>(p.value);
  const [reason, setReason] = useState("");
  const save = useAction(async () => {
    await api.setParameter(p.key, value, reason.trim());
    setReason("");
    onSaved();
    return true;
  });
  const dirty = value !== p.value;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dirty && reason.trim().length >= 10) void save.run();
  };
  const range = p.type === "number" && (p.min !== undefined || p.max !== undefined) ? ` (de ${p.min ?? "…"} a ${p.max ?? "…"}${p.unit ? ` ${p.unit}` : ""})` : p.unit ? ` (${p.unit})` : "";
  return (
    <li className="card card--flat">
      <form className="stack" onSubmit={submit} noValidate>
        <p style={{ margin: 0 }}>
          <strong>{p.description}</strong> <span className="mono muted">{p.key}</span>
        </p>
        <div className="grid-2">
          {p.type === "boolean" ? (
            <label className="row">
              <input type="checkbox" checked={value === true} onChange={(e) => setValue(e.target.checked)} />
              Activado
            </label>
          ) : (
            <Field label={`Valor${range}`}>
              {(fp) => (
                <input
                  {...fp}
                  className="input"
                  type={p.type === "number" ? "number" : "text"}
                  min={p.min}
                  max={p.max}
                  value={String(value)}
                  onChange={(e) => setValue(p.type === "number" ? Number(e.target.value) : e.target.value)}
                />
              )}
            </Field>
          )}
          {dirty && <Field label="Motivo del cambio" hint="Al menos 10 caracteres.">{(fp) => <input {...fp} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>}
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {p.changed ? `Versión ${p.changed.version}: cambiado el ${formatDateTime(p.changed.updatedAt)} — «${p.changed.reason}»` : `Valor por defecto (${String(p.default)})`}
        </p>
        {dirty && (
          <div className="row">
            <button className="btn btn--small" type="submit" disabled={save.pending || reason.trim().length < 10}>
              Guardar
            </button>
            <button className="btn btn--ghost btn--small" type="button" onClick={() => setValue(p.value)}>
              Descartar
            </button>
          </div>
        )}
        <ErrorAlert error={save.error} />
        {save.result && !dirty && (
          <Notice tone="ok">
            <p>Guardado.</p>
          </Notice>
        )}
      </form>
    </li>
  );
}

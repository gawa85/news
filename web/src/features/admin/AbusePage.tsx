import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { NewRestriction, Restriction } from "../../api/backofficeTypes";
import { formatDateTime } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const KIND: Record<Restriction["target"]["kind"], string> = { user: "Cuenta", ip: "IP o red", address: "Número o chat", email: "Mail" };

const active = (r: Restriction) => !r.liftedAt && (!r.until || new Date(r.until) > new Date());

/** ABUSO: restricciones automáticas y manuales (captcha obligatorio o bloqueo), y levantarlas. */
export function AbusePage() {
  const api = useBackoffice();
  const list = useAsync(() => api.restrictions(), [api]);
  const [onlyActive, setOnlyActive] = useState(true);
  const items = (list.data ?? []).filter((r) => !onlyActive || active(r));
  const upsert = (r: Restriction) => list.setData([r, ...(list.data ?? []).filter((x) => x.id !== r.id)]);
  return (
    <Page title="Abuso y restricciones" lead="Las automáticas salen del freno contra el abuso; las manuales, del equipo. Todas quedan registradas.">
      <NewRestrictionForm onCreated={upsert} />
      <section className="card stack" aria-labelledby="restricciones">
        <h2 id="restricciones">Restricciones</h2>
        <label className="row">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          Sólo las vigentes
        </label>
        {list.loading && !list.data && <Spinner />}
        <ErrorAlert error={list.error} />
        {list.data && items.length === 0 && <p className="muted">No hay restricciones{onlyActive ? " vigentes" : ""}.</p>}
        {items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Restricciones</caption>
              <thead>
                <tr>
                  <th scope="col">A quién</th>
                  <th scope="col">Qué</th>
                  <th scope="col">Por qué</th>
                  <th scope="col">Hasta</th>
                  <th scope="col">
                    <span className="visually-hidden">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <RestrictionRow key={r.id} r={r} onLifted={upsert} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Page>
  );
}

function RestrictionRow({ r, onLifted }: { r: Restriction; onLifted: (r: Restriction) => void }) {
  const api = useBackoffice();
  const lift = useAction(async () => onLifted(await api.liftRestriction(r.id)));
  return (
    <tr>
      <th scope="row">
        {KIND[r.target.kind]}: <span className="mono">{r.target.value}</span>
      </th>
      <td>
        <span className={`badge ${r.level === "block" ? "badge--danger" : "badge--smoke"}`}>{r.level === "block" ? "Bloqueo" : "Captcha"}</span> {r.automatic && <span className="muted">(automática)</span>}
      </td>
      <td>{r.reason}</td>
      <td>{r.liftedAt ? `Levantada ${formatDateTime(r.liftedAt)}` : r.until ? formatDateTime(r.until) : "Hasta levantarla"}</td>
      <td>
        {active(r) && (
          <button className="btn btn--ghost btn--small" type="button" onClick={() => void lift.run()} disabled={lift.pending} aria-label={`Levantar la restricción a ${r.target.value}`}>
            Levantar
          </button>
        )}
        <ErrorAlert error={lift.error} />
      </td>
    </tr>
  );
}

function NewRestrictionForm({ onCreated }: { onCreated: (r: Restriction) => void }) {
  const api = useBackoffice();
  const [form, setForm] = useState<NewRestriction>({ kind: "user", value: "", level: "block", reason: "" });
  const [hours, setHours] = useState("");
  const create = useAction(async () => {
    const r = await api.restrict({ ...form, value: form.value.trim(), reason: form.reason.trim(), ...(hours ? { hours: Number(hours) } : {}) });
    onCreated(r);
    setForm({ ...form, value: "", reason: "" });
    return r;
  });
  const valid = form.value.trim() && form.reason.trim().length >= 5;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) void create.run();
  };
  return (
    <details className="card">
      <summary>Nueva restricción</summary>
      <form className="stack" onSubmit={submit} noValidate style={{ marginTop: "var(--space-4)" }}>
        <div className="grid-2">
          <Field label="Tipo">
            {(p) => (
              <select {...p} className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as NewRestriction["kind"] })}>
                {(Object.keys(KIND) as NewRestriction["kind"][]).map((k) => (
                  <option key={k} value={k}>
                    {KIND[k]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Valor" hint="Id de cuenta, IP, número, chat id o mail.">
            {(p) => <input {...p} className="input mono" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />}
          </Field>
          <Field label="Qué hacer">
            {(p) => (
              <select {...p} className="select" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as NewRestriction["level"] })}>
                <option value="block">Bloquear</option>
                <option value="challenge">Pedir captcha</option>
              </select>
            )}
          </Field>
          <Field label="Horas" hint="Vacío = hasta levantarla.">
            {(p) => <input {...p} className="input" type="number" min={1} value={hours} onChange={(e) => setHours(e.target.value)} />}
          </Field>
        </div>
        <Field label="Motivo" hint="Queda registrado (al menos 5 letras).">
          {(p) => <input {...p} className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
        </Field>
        <div className="row">
          <button className="btn" type="submit" disabled={create.pending || !valid}>
            Restringir
          </button>
        </div>
        <ErrorAlert error={create.error} />
        {create.result && !create.pending && (
          <Notice tone="ok">
            <p>Restricción aplicada.</p>
          </Notice>
        )}
      </form>
    </details>
  );
}

import { useState } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { FeatureFlag, FlagPatch } from "../../api/backofficeTypes";
import { formatDateTime } from "../../domain/labels";
import { ErrorAlert, Field, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * FUNCIONES EN PRUEBA: prender o apagar una función (también de emergencia), y darla primero a
 * un porcentaje de personas, a ciertos planes, países, cuentas u organizaciones.
 */
export function FlagsPage() {
  const api = useBackoffice();
  const flags = useAsync(() => api.flags(), [api]);
  const replace = (f: FeatureFlag) => flags.setData((flags.data ?? []).map((x) => (x.key === f.key ? f : x)));
  return (
    <Page title="Funciones en prueba" lead="Apagar una función corta su uso enseguida (sirve de freno de emergencia).">
      {flags.loading && !flags.data && <Spinner />}
      <ErrorAlert error={flags.error} />
      <ul className="plain-list stack">
        {(flags.data ?? []).map((f) => (
          <FlagItem key={f.key} f={f} onSaved={replace} />
        ))}
      </ul>
    </Page>
  );
}

function FlagItem({ f, onSaved }: { f: FeatureFlag; onSaved: (f: FeatureFlag) => void }) {
  const api = useBackoffice();
  const [rollout, setRollout] = useState(f.rolloutPercent);
  const [plans, setPlans] = useState(f.plans.join(", "));
  const [countries, setCountries] = useState(f.countries.join(", "));
  const update = useAction(async (patch: FlagPatch) => onSaved(await api.updateFlag(f.key, patch)));
  const changed = rollout !== f.rolloutPercent || plans !== f.plans.join(", ") || countries !== f.countries.join(", ");
  return (
    <li className="card card--flat stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          <strong>{f.description}</strong> <span className="mono muted">{f.key}</span>
        </span>
        <label className="row">
          <input type="checkbox" checked={f.enabled} disabled={update.pending} onChange={(e) => void update.run({ enabled: e.target.checked })} />
          {f.enabled ? "Prendida" : "Apagada"}
        </label>
      </div>
      <div className="grid-2">
        <Field label={`Porcentaje de personas (${f.key})`} hint="0 a 100. Siempre la misma persona cae del mismo lado.">
          {(p) => <input {...p} className="input" type="number" min={0} max={100} value={rollout} onChange={(e) => setRollout(Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))))} />}
        </Field>
        <Field label={`Sólo estos planes (${f.key})`} hint="Separados por coma; vacío = todos.">
          {(p) => <input {...p} className="input" value={plans} onChange={(e) => setPlans(e.target.value)} />}
        </Field>
        <Field label={`Sólo estos países (${f.key})`} hint="Códigos (AR, UY…); vacío = todos.">
          {(p) => <input {...p} className="input" value={countries} onChange={(e) => setCountries(e.target.value.toUpperCase())} />}
        </Field>
      </div>
      {(f.allowUsers.length > 0 || f.allowOrgs.length > 0) && (
        <p className="muted">
          Además, siempre para {f.allowUsers.length} cuenta(s) y {f.allowOrgs.length} organización(es) elegidas.
        </p>
      )}
      <div className="row">
        {changed && (
          <button className="btn btn--small" type="button" disabled={update.pending} onClick={() => void update.run({ rolloutPercent: rollout, plans: list(plans), countries: list(countries) })}>
            Guardar cambios
          </button>
        )}
        <span className="muted">{f.updatedBy === "sistema" ? "Como viene de fábrica." : `Cambiada el ${formatDateTime(f.updatedAt)}.`}</span>
      </div>
      <ErrorAlert error={update.error} />
    </li>
  );
}

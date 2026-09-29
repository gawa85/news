import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { AdminPlan, AdminPlanLimits, NewPlan, PlanCatalog } from "../../api/backofficeTypes";
import { formatDateTime, formatNumber } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const LIMITS: Record<keyof AdminPlanLimits, string> = {
  analysesPerDay: "Análisis por día",
  comparisonsPerMonth: "Comparaciones por mes",
  maxSourcesPerComparison: "Fuentes por comparación",
  maxIncludeUrls: "Sitios por regla",
  maxSavedRuleSets: "Reglas guardadas",
  maxAlerts: "Alertas",
  maxSourceConnections: "Fuentes conectadas",
  seats: "Lugares (personas)",
};
const LIMIT_KEYS = Object.keys(LIMITS) as (keyof AdminPlanLimits)[];

/** Lo que el cambio le quitaría a quien ya tiene el plan (el servidor lo impide con suscripciones vigentes). */
function reductions(before: AdminPlan, features: string[], limits: AdminPlanLimits, labelOf: (id: string) => string): string[] {
  const out = before.features.filter((f) => !features.includes(f)).map((f) => `quita ${labelOf(f)}`);
  for (const k of LIMIT_KEYS) {
    const a = before.limits[k];
    const b = limits[k];
    if (b !== null && (a === null || b < a)) out.push(`baja ${LIMITS[k].toLowerCase()}`);
  }
  return out;
}

/**
 * PLANES: precios, límites y funciones. Un precio nuevo vale para las suscripciones nuevas; con
 * suscripciones vigentes no se le quita nada a un plan.
 */
export function PlansAdminPage() {
  const api = useBackoffice();
  const data = useAsync(() => api.planCatalog(), [api]);
  const replace = (p: AdminPlan) => data.data && data.setData({ ...data.data, plans: data.data.plans.map((x) => (x.id === p.id ? p : x)) });
  // Volver a la versión del código recarga el formulario con esos valores (guardar no: se perdería el aviso).
  const [resets, setResets] = useState<Record<string, number>>({});
  const afterReset = (p: AdminPlan) => {
    replace(p);
    setResets((r) => ({ ...r, [p.id]: (r[p.id] ?? 0) + 1 }));
  };
  return (
    <Page title="Planes" lead="Un plan editado acá deja de actualizarse desde el código hasta que lo vuelvas a su versión original.">
      {data.loading && !data.data && <Spinner />}
      <ErrorAlert error={data.error} />
      {data.data && (
        <NewPlanForm
          plans={data.data.plans}
          onCreated={(p) => {
            data.setData({ ...data.data!, plans: [...data.data!.plans, p].sort((a, b) => a.tier - b.tier) });
          }}
        />
      )}
      {data.data?.plans.map((p) => (
        <PlanForm key={`${p.id}:${resets[p.id] ?? 0}`} plan={p} catalog={data.data!} onSaved={replace} onReset={afterReset} />
      ))}
    </Page>
  );
}

function PlanForm({ plan, catalog, onSaved, onReset }: { plan: AdminPlan; catalog: PlanCatalog; onSaved: (p: AdminPlan) => void; onReset: (p: AdminPlan) => void }) {
  const api = useBackoffice();
  const labelOf = (id: string) => catalog.features.find((f) => f.id === id)?.label ?? id;
  const [name, setName] = useState(plan.name);
  const [description, setDescription] = useState(plan.description);
  const [monthly, setMonthly] = useState(plan.price ? String(plan.price.amount) : "");
  const [yearly, setYearly] = useState(plan.yearlyPrice ? String(plan.yearlyPrice.amount) : "");
  const [features, setFeatures] = useState(plan.features);
  const [limits, setLimits] = useState(plan.limits);
  const save = useAction(async () => {
    const saved = await api.updatePlan(plan.id, {
      name: name.trim(), description: description.trim(), features, limits,
      monthlyAmount: plan.price ? Number(monthly) : undefined,
      yearlyAmount: plan.price && yearly.trim() ? Number(yearly) : null,
    });
    onSaved(saved);
    return saved;
  });
  const reset = useAction(async () => onReset(await api.resetPlan(plan.id)));
  const sale = useAction(async () => onSaved(await api.setPlanForSale(plan.id, plan.forSale === false)));
  const lost = reductions(plan, features, limits, labelOf);
  const priceOk = !plan.price || Number(monthly) > 0;
  const yearlyOk = !yearly.trim() || Number(yearly) > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && priceOk && yearlyOk) void save.run();
  };
  const id = `plan-${plan.id}`;
  const currency = plan.price?.currency ?? "";
  return (
    <form className="card stack" onSubmit={submit} aria-labelledby={id} noValidate>
      <h2 id={id} style={{ margin: 0 }}>
        {plan.name} {plan.forSale === false && <span className="badge badge--danger">No se vende</span>} {plan.customized && <span className="badge badge--neutral">Personalizado</span>}
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        {formatNumber(plan.liveSubscriptions)} suscripción(es) vigente(s) · {plan.audience === "organization" ? "para organizaciones" : "para personas"}
        {plan.customized && ` · editado el ${formatDateTime(plan.customized.at)}`}
      </p>
      <div className="grid-2">
        <Field label={`Nombre (${plan.id})`} error={!name.trim() ? "Falta el nombre." : undefined}>
          {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label={`Descripción (${plan.id})`}>{(p) => <input {...p} className="input" value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        {plan.price ? (
          <>
            <Field label={`Precio mensual en ${currency} (${plan.id})`} hint="Vale para las suscripciones nuevas." error={!priceOk ? "Tiene que ser mayor que cero." : undefined}>
              {(p) => <input {...p} className="input" type="number" min={1} step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} />}
            </Field>
            <Field label={`Precio anual en ${currency} (${plan.id})`} hint="Vacío: sin opción anual." error={!yearlyOk ? "Tiene que ser mayor que cero." : undefined}>
              {(p) => <input {...p} className="input" type="number" min={1} step="0.01" value={yearly} onChange={(e) => setYearly(e.target.value)} />}
            </Field>
          </>
        ) : (
          <p className="muted">Plan gratis: no tiene precio.</p>
        )}
      </div>
      <fieldset className="stack">
        <legend>Límites ({plan.name})</legend>
        <div className="grid-2">
          {LIMIT_KEYS.map((k) => (
            <LimitField key={k} label={`${LIMITS[k]} (${plan.id})`} value={limits[k]} onChange={(v) => setLimits({ ...limits, [k]: v })} />
          ))}
        </div>
      </fieldset>
      <fieldset className="stack">
        <legend>Funciones ({plan.name})</legend>
        <div className="grid-2">
          {catalog.features.map((f) => (
            <label key={f.id} className="row">
              <input type="checkbox" checked={features.includes(f.id)} onChange={(e) => setFeatures(e.target.checked ? [...features, f.id] : features.filter((x) => x !== f.id))} />
              {f.label}
            </label>
          ))}
        </div>
      </fieldset>
      {lost.length > 0 && plan.liveSubscriptions > 0 && (
        <Notice>
          <p>Este cambio {lost.join(", ")}: con suscripciones vigentes no se puede. Para eso, creá otro plan (Nuevo plan, arriba) y sacá este de la venta.</p>
        </Notice>
      )}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn btn--small" type="submit" disabled={save.pending || (lost.length > 0 && plan.liveSubscriptions > 0)}>
          Guardar {plan.name}
        </button>
        {plan.price && (
          <button className="btn btn--ghost btn--small" type="button" disabled={sale.pending} onClick={() => void sale.run()}>
            {plan.forSale === false ? `Volver a ofrecer ${plan.name}` : `Sacar ${plan.name} de la venta`}
          </button>
        )}
        {plan.customized && (
          <button className="btn btn--ghost btn--small" type="button" disabled={reset.pending} onClick={() => void reset.run()}>
            Volver a la versión del código
          </button>
        )}
      </div>
      <ErrorAlert error={save.error ?? reset.error ?? sale.error} />
      {plan.forSale === false && (
        <p className="muted" style={{ margin: 0 }}>
          No se ofrece ni se puede elegir. Quien ya lo tiene lo conserva y se le sigue renovando.
        </p>
      )}
      {save.result && (
        <Notice tone="ok">
          <p>Guardado. Quien ya estaba suscripto sigue pagando lo que contrató.</p>
        </Notice>
      )}
    </form>
  );
}

/** Un límite: un número, o "sin límite". */
function LimitField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const [last, setLast] = useState(value ?? 10);
  return (
    <div className="stack" style={{ gap: "0.25rem" }}>
      <Field label={label}>
        {(p) => (
          <input
            {...p}
            className="input"
            type="number"
            min={0}
            step={1}
            disabled={value === null}
            value={value ?? ""}
            onChange={(e) => {
              const n = Math.max(0, Math.round(Number(e.target.value) || 0));
              setLast(n);
              onChange(n);
            }}
          />
        )}
      </Field>
      <label className="row">
        <input type="checkbox" aria-label={`Sin límite: ${label}`} checked={value === null} onChange={(e) => onChange(e.target.checked ? null : last)} />
        Sin límite
      </label>
    </div>
  );
}

/** Plan nuevo: copia funciones, límites y canales de uno existente; después se ajusta en su tarjeta. */
function NewPlanForm({ plans, onCreated }: { plans: AdminPlan[]; onCreated: (p: AdminPlan) => void }) {
  const api = useBackoffice();
  const paid = plans.filter((p) => p.price);
  const [open, setOpen] = useState(false);
  const [basedOn, setBasedOn] = useState(paid[0]?.id ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [monthly, setMonthly] = useState("");
  const [yearly, setYearly] = useState("");
  const [tier, setTier] = useState(String(paid[0]?.tier ?? 1));
  const [tried, setTried] = useState(false);
  const create = useAction(async (input: NewPlan) => {
    const p = await api.createPlan(input);
    onCreated(p);
    setName("");
    setDescription("");
    setMonthly("");
    setYearly("");
    setTried(false);
    return p;
  });
  const priceOk = Number(monthly) > 0;
  const yearlyOk = !yearly.trim() || Number(yearly) > 0;
  const tierOk = /^\d{1,3}$/.test(tier.trim()) && Number(tier) <= 100;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!name.trim() || !priceOk || !yearlyOk || !tierOk || !basedOn) return;
    void create.run({ basedOn, name: name.trim(), description: description.trim(), monthlyAmount: Number(monthly), yearlyAmount: yearly.trim() ? Number(yearly) : null, tier: Number(tier) });
  };
  return (
    <section className="card stack" aria-labelledby="nuevo-plan">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="nuevo-plan" style={{ margin: 0 }}>
          Nuevo plan
        </h2>
        <button className="btn btn--ghost btn--small" type="button" aria-expanded={open} aria-controls="nuevo-plan-form" onClick={() => setOpen(!open)}>
          {open ? "Cerrar" : "Crear un plan"}
        </button>
      </div>
      {create.result && !open && (
        <Notice tone="ok">
          <p>Plan «{create.result.name}» creado. Ajustá sus funciones y límites en su tarjeta, más abajo.</p>
        </Notice>
      )}
      {open && (
        <form id="nuevo-plan-form" className="stack" onSubmit={submit} noValidate>
          <p className="muted" style={{ margin: 0 }}>
            Copia las funciones, los límites y los canales del plan que elijas; después los ajustás. El id sale del nombre y no cambia.
          </p>
          <div className="grid-2">
            <Field label="Copiar de">
              {(p) => (
                <select {...p} className="input" value={basedOn} onChange={(e) => setBasedOn(e.target.value)}>
                  {paid.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.forSale === false ? " (no se vende)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Nombre del plan nuevo" error={tried && !name.trim() ? "Falta el nombre." : undefined}>
              {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Descripción del plan nuevo">{(p) => <input {...p} className="input" value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
            <Field label="Precio mensual del plan nuevo" error={tried && !priceOk ? "Tiene que ser mayor que cero." : undefined}>
              {(p) => <input {...p} className="input" type="number" min={1} step="0.01" value={monthly} onChange={(e) => setMonthly(e.target.value)} />}
            </Field>
            <Field label="Precio anual del plan nuevo" hint="Vacío: sin opción anual." error={tried && !yearlyOk ? "Tiene que ser mayor que cero." : undefined}>
              {(p) => <input {...p} className="input" type="number" min={1} step="0.01" value={yearly} onChange={(e) => setYearly(e.target.value)} />}
            </Field>
            <Field label="Orden" hint="Para sugerir mejoras: menor = más barato (0 a 100)." error={tried && !tierOk ? "Un entero de 0 a 100." : undefined}>
              {(p) => <input {...p} className="input" type="number" min={0} max={100} step={1} value={tier} onChange={(e) => setTier(e.target.value)} />}
            </Field>
          </div>
          <div className="row">
            <button className="btn btn--small" type="submit" disabled={create.pending}>
              Crear el plan
            </button>
          </div>
          <ErrorAlert error={create.error} />
          {create.result && (
            <Notice tone="ok">
              <p>Plan «{create.result.name}» creado. Ajustá sus funciones y límites en su tarjeta, más abajo.</p>
            </Notice>
          )}
        </form>
      )}
    </section>
  );
}

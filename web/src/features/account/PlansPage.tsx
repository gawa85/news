import { useState } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { PublicPlan } from "../../api/types";
import { formatPrice, limitText } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

/** PLANES: qué incluye cada uno y, con sesión, pasarse (al pago del proveedor). */
export function PlansPage() {
  const api = useApi();
  const { me } = useSession();
  const plans = useAsync(() => api.plans(), [api]);
  const [interval, setBilling] = useState<"month" | "year">("month");
  const [coupon, setCoupon] = useState("");
  const change = useAction(async (planId: string) => {
    const r = await api.checkout(planId, interval, coupon.trim() || undefined);
    // Plan pago: al pago del proveedor (vuelve solo). Gratis o cupón del 100%: ya quedó activo.
    if (r.checkoutUrl) window.location.assign(r.checkoutUrl);
    return r;
  });

  return (
    <Page title="Planes" lead="Empezá gratis. Pasate cuando necesites más análisis, el medidor de credibilidad o la API.">
      <fieldset className="row">
        <legend>Forma de pago</legend>
        <label className="checkbox">
          <input type="radio" name="intervalo" checked={interval === "month"} onChange={() => setBilling("month")} /> Mensual
        </label>
        <label className="checkbox">
          <input type="radio" name="intervalo" checked={interval === "year"} onChange={() => setBilling("year")} /> Anual (con meses de regalo)
        </label>
      </fieldset>
      {plans.loading && <Spinner />}
      <ErrorAlert error={plans.error} />
      <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 16rem), 1fr))" }}>
        {plans.data?.map((p) => (
          <PlanCard key={p.id} plan={p} interval={interval} current={me?.plan.id === p.id} loggedIn={!!me} pending={change.pending} onChoose={() => void change.run(p.id)} />
        ))}
      </div>
      {me && (
        <Field label="¿Tenés un cupón o un código de invitación?">
          {(p) => <input {...p} className="input" style={{ maxWidth: "20rem" }} value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />}
        </Field>
      )}
      <ErrorAlert error={change.error} />
      {change.result && !change.result.checkoutUrl && <Notice tone="ok">Listo: tu plan ya está activo.</Notice>}
      <p className="muted">Los precios incluyen impuestos. Podés cambiar de plan cuando quieras.</p>
    </Page>
  );
}

function PlanCard({ plan, interval, current, loggedIn, pending, onChoose }: { plan: PublicPlan; interval: "month" | "year"; current: boolean; loggedIn: boolean; pending: boolean; onChoose: () => void }) {
  const price = interval === "year" && plan.yearlyPrice ? plan.yearlyPrice : plan.price;
  return (
    <article className="card stack" aria-labelledby={`plan-${plan.id}`}>
      <h2 id={`plan-${plan.id}`}>
        {plan.name} {current && <span className="badge badge--fact">Tu plan</span>}
      </h2>
      <p style={{ fontSize: "1.4rem", fontWeight: 750, margin: 0 }}>{formatPrice(price)}</p>
      <p className="muted">{plan.description}</p>
      <ul>
        <li>{limitText(plan.limits.analysesPerDay, "análisis por día")}</li>
        <li>{limitText(plan.limits.comparisonsPerMonth, "comparaciones por mes")}</li>
        {plan.features.map((f) => (
          <li key={f.id}>{f.label}</li>
        ))}
      </ul>
      {current ? null : loggedIn ? (
        <button type="button" className="btn" onClick={onChoose} disabled={pending}>
          {plan.price ? `Pasarme a ${plan.name}` : `Volver a ${plan.name}`}
        </button>
      ) : (
        <Link className="btn" to={`/entrar?next=${encodeURIComponent("/planes")}`}>
          Empezar
        </Link>
      )}
    </article>
  );
}

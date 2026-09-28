import { useState } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { BusinessStats } from "../../api/backofficeTypes";
import { formatNumber } from "../../domain/labels";
import { ErrorAlert, Field, Page, Spinner } from "../../ui/components";
import { useAsync } from "../../ui/useAsync";
import { isoDay } from "../shared/catalog";

const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`);

/** MÉTRICAS DEL NEGOCIO: ingresos recurrentes, pagantes, altas, bajas y conversión en un período. */
export function MetricsPage() {
  const api = useBackoffice();
  const [from, setFrom] = useState(isoDay(30));
  const [to, setTo] = useState(isoDay(0));
  const stats = useAsync(() => api.businessStats(new Date(`${from}T00:00:00-03:00`).toISOString(), new Date(`${to}T23:59:59-03:00`).toISOString()), [api, from, to]);
  const s = stats.data;
  return (
    <Page title="Métricas del negocio">
      <div className="card grid-2">
        <Field label="Desde">{(p) => <input {...p} className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="Hasta">{(p) => <input {...p} className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
      {stats.loading && <Spinner />}
      <ErrorAlert error={stats.error} />
      {s && <StatsView s={s} />}
    </Page>
  );
}

function StatsView({ s }: { s: BusinessStats }) {
  const money = (n: number | null) => (n === null ? "—" : new Intl.NumberFormat("es-AR", { style: "currency", currency: s.currency, maximumFractionDigits: 0 }).format(n));
  const delta = (now: number, before: number) => (before === 0 ? "" : ` (${now >= before ? "+" : ""}${Math.round(((now - before) / before) * 100)} %)`);
  return (
    <div className="stack">
      <section className="card" aria-labelledby="resumen-negocio">
        <h2 id="resumen-negocio" className="visually-hidden">
          Resumen
        </h2>
        <dl className="stats">
          <div>
            <dt>Ingreso mensual recurrente</dt>
            <dd>
              {money(s.mrr)}
              <span className="muted" style={{ fontSize: "0.9rem", fontWeight: 400 }}>{delta(s.mrr, s.mrrAtStart)}</span>
            </dd>
          </div>
          <div>
            <dt>Clientes que pagan</dt>
            <dd>
              {formatNumber(s.payingSubjects)}
              <span className="muted" style={{ fontSize: "0.9rem", fontWeight: 400 }}>{delta(s.payingSubjects, s.payingAtStart)}</span>
            </dd>
          </div>
          <div>
            <dt>Ingreso promedio por cliente</dt>
            <dd>{money(s.arpu)}</dd>
          </div>
          <div>
            <dt>Bajas del período</dt>
            <dd>{pct(s.churnRate)}</dd>
          </div>
        </dl>
      </section>
      <div className="table-wrap card">
        <table className="table">
          <caption>Movimiento del período</caption>
          <tbody>
            {[
              ["Registros nuevos", formatNumber(s.registrations)],
              ["Activaciones (usaron el producto)", `${formatNumber(s.activations)} · ${pct(s.activationRate)}`],
              ["Pasaron a pagar", `${formatNumber(s.newPaying)} · conversión ${pct(s.conversionRate)}`],
              ["Se dieron de baja", formatNumber(s.churned)],
              ["En prueba gratis", formatNumber(s.trialing)],
            ].map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap card">
        <table className="table">
          <caption>Por plan</caption>
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Clientes</th>
              <th scope="col">Ingreso mensual</th>
            </tr>
          </thead>
          <tbody>
            {s.byPlan.map((p) => (
              <tr key={p.planId}>
                <th scope="row">{p.planId}</th>
                <td>{formatNumber(p.subjects)}</td>
                <td>{money(p.mrr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">Montos en {s.currency}; las suscripciones cobradas en otra moneda no se suman.</p>
    </div>
  );
}

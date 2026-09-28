import { useState } from "react";
import { Link, useParams } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { ObservatoryReport, PublicRebuttal } from "../../api/types";
import { CHANNEL_NAMES, formatDate, formatNumber, SMOKE_LABELS } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Page, Spinner } from "../../ui/components";
import { useAsync } from "../../ui/useAsync";
import { useOutlets } from "../shared/catalog";

const KIND: Record<string, string> = { newspaper: "Diario", digital: "Medio digital", tv: "Televisión", radio: "Radio", official: "Organismo oficial", wire_agency: "Agencia de noticias" };
const REBUTTAL_STATUS: Record<PublicRebuttal["status"], string> = { submitted: "En revisión", accepted: "Aceptada", partially_accepted: "Aceptada en parte", rejected: "Rechazada" };
const money = (amount: number, currency: string) => new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
const thisMonth = () => new Date().toISOString().slice(0, 7);

// ---------------------------------------------------------------- Observatorio

/** OBSERVATORIO: qué humo circuló, por tipo, canal y tema. Datos agregados y anónimos. */
export function ObservatoryPage() {
  const api = useApi();
  const [month, setMonth] = useState(thisMonth());
  const report = useAsync(() => api.observatory(month), [api, month]);
  const now = useAsync(() => api.narratives(7), [api]);
  return (
    <Page title="Observatorio" lead="Qué humo está circulando: cadenas, tipos de manipulación, temas y canales. Datos agregados y anónimos, abiertos para descargar.">
      <section className="card stack" aria-labelledby="circulando">
        <h2 id="circulando">Circulando esta semana</h2>
        {now.loading && <Spinner />}
        <ErrorAlert error={now.error} />
        {now.data?.length === 0 && <p className="muted">Nada que se repita lo suficiente esta semana.</p>}
        <ol className="plain-list stack">
          {now.data?.map((n) => (
            <li key={n.id} className="finding">
              <p style={{ margin: 0 }}>«{n.sample}»</p>
              <p className="muted" style={{ margin: "var(--space-1) 0 0" }}>
                {formatNumber(n.occurrences)} veces · desde el {formatDate(n.firstSeenAt)} · humo promedio {Math.round(n.avgSmokeIndex)}/100
                {n.countered && " · ya tiene respuesta"}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <div className="card">
        <Field label="Mes">{(p) => <input {...p} className="input" type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />}</Field>
      </div>
      {report.loading && <Spinner />}
      <ErrorAlert error={report.error} />
      {report.data && <MonthReport r={report.data} />}
      <p>
        <Link to="/datos">Datos abiertos</Link> · <Link to="/fe-de-erratas">Fe de erratas</Link> · <Link to="/medios">Medios</Link>
      </p>
    </Page>
  );
}

function MonthReport({ r }: { r: ObservatoryReport }) {
  const table = (caption: string, rows: [string, number][]) =>
    rows.length === 0 ? null : (
      <div className="card table-wrap">
        <table className="table">
          <caption>{caption}</caption>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{formatNumber(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <div className="stack">
      <section className="card" aria-labelledby="mes">
        <h2 id="mes" className="visually-hidden">
          Resumen del mes
        </h2>
        <dl className="stats">
          <div>
            <dt>Mensajes analizados</dt>
            <dd>{formatNumber(r.totals.analyses)}</dd>
          </div>
          <div>
            <dt>Tenían mucho humo</dt>
            <dd>{r.totals.smokeRate === null ? "—" : `${Math.round(r.totals.smokeRate * 100)} %`}</dd>
          </div>
        </dl>
      </section>
      <div className="grid-2">
        {table("Tipos de humo", r.smokeTypes.map((x) => [SMOKE_LABELS[x.type as keyof typeof SMOKE_LABELS] ?? x.type, x.count]))}
        {table("Por dónde llegaron", r.channels.map((x) => [CHANNEL_NAMES[x.channel] ?? x.channel, x.count]))}
      </div>
      {table("Temas", r.topics.map((x) => [x.topic, x.count]))}
      <details className="card">
        <summary>Cómo se hace (metodología y privacidad)</summary>
        <p>{r.methodology}</p>
        <p className="muted">
          Sólo se publican grupos de al menos {r.minGroupSize} personas distintas, redondeados a {r.rounding}.
          {r.suppressedGroups > 0 && ` Este mes se ocultaron ${r.suppressedGroups} grupos por ser demasiado chicos.`}
        </p>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- Medios

/** MEDIOS: la lista, con link a la ficha de cada uno. */
export function OutletsPage() {
  const { list } = useOutlets();
  const [q, setQ] = useState("");
  const shown = list.filter((o) => !q.trim() || o.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Page title="Medios" lead="Quién es dueño de cada medio, cuánta pauta oficial recibe y cómo responde a las réplicas.">
      <Field label="Buscar un medio">{(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
      <ul className="plain-list stack">
        {shown.map((o) => (
          <li key={o.id} className="card card--flat">
            <Link to={`/medios/${encodeURIComponent(o.id)}`}>
              <strong>{o.name}</strong>
            </Link>{" "}
            <span className="muted">
              · {KIND[o.kind] ?? o.kind}
              {o.region.province ? ` · ${o.region.province}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Page>
  );
}

/** FICHA DE UN MEDIO: dueños, pauta oficial, réplicas y fe de erratas. */
export function OutletPage() {
  const api = useApi();
  const { me } = useSession();
  const { id = "" } = useParams();
  const p = useAsync(() => api.outletProfile(id), [api, id]);
  if (p.loading) return <div className="page"><Spinner /></div>;
  if (!p.data) return <Page title="Medio"><ErrorAlert error={p.error} /></Page>;
  const { outlet, owners, advertising, rebuttals, corrections } = p.data;
  return (
    <Page title={outlet.name} lead={`${KIND[outlet.kind] ?? outlet.kind}${outlet.region.province ? ` · ${outlet.region.province}` : ""}`}>
      <p>
        <a href={outlet.url} target="_blank" rel="noopener noreferrer">
          {outlet.url.replace(/^https?:\/\//, "")}
        </a>
      </p>
      <section className="card stack" aria-labelledby="duenos">
        <h2 id="duenos">Quién es su dueño</h2>
        {owners.length === 0 ? (
          <p className="muted">No tenemos datos de propiedad de este medio.</p>
        ) : (
          <ul>
            {owners.map((o) => (
              <li key={`${o.name}${o.since}`}>
                <strong>{o.name}</strong>
                {o.businessSectors.length > 0 && ` — también tiene negocios en ${o.businessSectors.join(", ")}`}
                <span className="muted">
                  {" "}
                  · desde {formatDate(o.since)}
                  {o.until && ` hasta ${formatDate(o.until)}`}
                  {o.source && ` · fuente: ${o.source === "semilla" ? "datos de demostración" : o.source}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card stack" aria-labelledby="pauta">
        <h2 id="pauta">Pauta oficial (último año)</h2>
        {advertising.length === 0 ? (
          <p className="muted">No hay pauta oficial registrada en los datos que tenemos.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Pauta oficial por quién paga</caption>
              <thead>
                <tr>
                  <th scope="col">Quién paga</th>
                  <th scope="col">Monto</th>
                </tr>
              </thead>
              <tbody>
                {advertising.map((a) => (
                  <tr key={`${a.payer}${a.currency}`}>
                    <th scope="row">
                      {a.payer} <span className="muted">({a.jurisdiction === "national" ? "nacional" : a.jurisdiction === "provincial" ? "provincial" : "municipal"})</span>
                    </th>
                    <td>{money(a.amount, a.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">Recibir pauta no significa mentir: es un contexto que conviene conocer al leer sobre quien paga.</p>
      </section>
      <section className="card stack" aria-labelledby="replicas">
        <h2 id="replicas">Réplicas y fe de erratas</h2>
        {rebuttals.length === 0 && corrections.length === 0 && <p className="muted">Sin réplicas ni correcciones.</p>}
        <ul className="plain-list stack">
          {corrections.map((c) => (
            <li key={c.id}>
              <span className="badge badge--fact">Fe de erratas</span> {formatDate(c.publishedAt)}: {c.description}
            </li>
          ))}
          {rebuttals.map((r) => (
            <li key={r.id}>
              <span className="badge badge--neutral">Réplica · {REBUTTAL_STATUS[r.status]}</span> {formatDate(r.createdAt)}: «{r.statement}»
              {r.resolution && <p className="muted" style={{ margin: "var(--space-1) 0 0" }}>Resolución: {r.resolution.note}</p>}
            </li>
          ))}
        </ul>
      </section>
      <div className="card">
        <p>
          ¿Qué tan creíble es en cada tema? <Link to={me ? "/credibilidad" : "/entrar?next=%2Fcredibilidad"}>Mirá su credibilidad por tema</Link> (precisión, fuentes, conflictos de interés y pauta).
        </p>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- Fe de erratas y datos abiertos

/** FE DE ERRATAS: lo que corregimos (nosotros o por réplica de un medio), a la vista de todos. */
export function CorrectionsPage() {
  const api = useApi();
  const { nameOf } = useOutlets();
  const list = useAsync(() => api.corrections(), [api]);
  return (
    <Page title="Fe de erratas" lead="Cuando nos equivocamos, lo decimos acá: qué se corrigió y cuándo.">
      {list.loading && <Spinner />}
      <ErrorAlert error={list.error} />
      {list.data?.length === 0 && <p className="muted">Todavía no hubo correcciones.</p>}
      <ol className="plain-list stack">
        {list.data?.map((c) => (
          <li key={c.id} className="card card--flat">
            <p className="muted" style={{ margin: 0 }}>
              {formatDate(c.publishedAt)}
              {c.outletId && (
                <>
                  {" · "}
                  <Link to={`/medios/${encodeURIComponent(c.outletId)}`}>{nameOf(c.outletId)}</Link>
                </>
              )}
              {c.rebuttalId && " · por réplica del medio"}
            </p>
            <p style={{ margin: "var(--space-1) 0 0" }}>{c.description}</p>
          </li>
        ))}
      </ol>
    </Page>
  );
}

/** DATOS ABIERTOS: los datasets agregados y anónimos, en CSV y JSON (licencia en cada uno). */
export function OpenDataPage() {
  const api = useApi();
  const list = useAsync(() => api.datasets(), [api]);
  return (
    <Page title="Datos abiertos" lead="Todo lo que publica el observatorio, para descargar y reusar. Agregado y anónimo: nunca datos de personas.">
      {list.loading && <Spinner />}
      <ErrorAlert error={list.error} />
      <ul className="plain-list stack">
        {list.data?.map((d) => (
          <li key={d.id} className="card stack">
            <h2 style={{ margin: 0 }}>{d.title}</h2>
            <p style={{ margin: 0 }}>{d.description}</p>
            <p className="muted" style={{ margin: 0 }}>
              Licencia {d.license} · se actualiza {d.updateFrequency} · último año por defecto
            </p>
            <details>
              <summary>Columnas ({d.columns.length})</summary>
              <dl>
                {d.columns.map((c) => (
                  <div key={c.name}>
                    <dt className="mono">{c.name}</dt>
                    <dd>{c.description}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <div className="row">
              <a className="btn btn--secondary btn--small" href={api.datasetUrl(d.id, "csv")} download>
                Bajar CSV<span className="visually-hidden"> de {d.title}</span>
              </a>
              <a className="btn btn--ghost btn--small" href={api.datasetUrl(d.id, "json")}>
                Ver JSON<span className="visually-hidden"> de {d.title}</span>
              </a>
            </div>
          </li>
        ))}
      </ul>
    </Page>
  );
}

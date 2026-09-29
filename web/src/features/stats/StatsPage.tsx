import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { ExportFormat, UsagePanel } from "../../api/types";
import { CHANNEL_NAMES, formatDate, formatDateTime, formatNumber, SMOKE_LABELS } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { isoDay } from "../shared/catalog";

const PERIODS = [
  { days: 7, label: "Últimos 7 días" },
  { days: 30, label: "Últimos 30 días" },
  { days: 90, label: "Últimos 90 días" },
  { days: 365, label: "Último año" },
];
const FORMATS: [ExportFormat, string][] = [["xlsx", "Excel"], ["csv", "CSV"], ["pdf", "PDF"]];
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)} %`);

type Bucket = { key: string; label: string; analyses: number; withSmoke: number };
type Grain = "day" | "week" | "month";
const GRAIN_TITLE: Record<Grain, string> = { day: "Mensajes por día", week: "Mensajes por semana", month: "Mensajes por mes" };

/**
 * Con muchos días las columnas quedan finitas e ilegibles: hasta 45 días, por día; hasta
 * 6 meses, por semana (desde el lunes); más, por mes.
 */
function bucketize(daily: UsagePanel["daily"]): { grain: Grain; buckets: Bucket[] } {
  const grain: Grain = daily.length <= 45 ? "day" : daily.length <= 186 ? "week" : "month";
  const map = new Map<string, Bucket>();
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-AR", { ...o, timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  for (const d of daily) {
    let key = d.day;
    if (grain === "week") {
      const dt = new Date(`${d.day}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      key = dt.toISOString().slice(0, 10);
    } else if (grain === "month") key = `${d.day.slice(0, 7)}-01`;
    const label = grain === "month" ? fmt(key, { month: "short", year: "2-digit" }) : grain === "week" ? `sem. ${fmt(key, { day: "numeric", month: "short" })}` : fmt(key, { day: "numeric", month: "short" });
    const b = map.get(key) ?? { key, label, analyses: 0, withSmoke: 0 };
    b.analyses += d.analyses;
    b.withSmoke += d.withSmoke;
    map.set(key, b);
  }
  return { grain, buckets: [...map.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

/** ESTADÍSTICAS: cuánto se analizó, cuánto humo había, de qué tipo y por dónde llegó; exportar y reportes por mail. */
export function StatsPage() {
  const api = useApi();
  const { has, can } = useSession();
  const [days, setDays] = useState(30);
  const canOrg = has("stats:org");
  const [scope, setScope] = useState<"user" | "organization">("user");
  const from = new Date(`${isoDay(days - 1)}T00:00:00-03:00`).toISOString();
  const to = new Date(`${isoDay(0)}T23:59:59-03:00`).toISOString();
  const panel = useAsync(() => api.usagePanel(scope, from, to), [api, scope, days]);
  const p = panel.data;
  return (
    <Page title="Estadísticas" lead="Qué se analizó, cuánto humo había, de qué tipo y por dónde llegó.">
      <div className="card row" style={{ alignItems: "end" }}>
        <Field label="Período">
          {(fp) => (
            <select {...fp} className="select" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {PERIODS.map((x) => (
                <option key={x.days} value={x.days}>
                  {x.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        {canOrg && (
          <Field label="De quién">
            {(fp) => (
              <select {...fp} className="select" value={scope} onChange={(e) => setScope(e.target.value as "user" | "organization")}>
                <option value="user">Mío</option>
                <option value="organization">De toda mi organización</option>
              </select>
            )}
          </Field>
        )}
      </div>
      {panel.loading && !p && <Spinner />}
      <ErrorAlert error={panel.error} />
      {p && <PanelView p={p} />}
      {p && <Exports scope={scope} from={from} to={to} canExport={can("export")} />}
      {can("scheduled_reports") && <Schedules canOrg={canOrg} />}
    </Page>
  );
}

function PanelView({ p }: { p: UsagePanel }) {
  const clean = p.totals.analyses - p.totals.withSmoke;
  const { grain, buckets } = bucketize(p.daily);
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
      <section className="card" aria-labelledby="resumen-uso">
        <h2 id="resumen-uso" className="visually-hidden">
          Resumen
        </h2>
        <dl className="stats">
          <div>
            <dt>Mensajes analizados</dt>
            <dd>{formatNumber(p.totals.analyses)}</dd>
          </div>
          <div>
            <dt>Con humo</dt>
            <dd>{pct(p.totals.smokeRate)}</dd>
          </div>
          <div>
            <dt>Comparaciones</dt>
            <dd>{formatNumber(p.totals.comparisons)}</dd>
          </div>
          {p.activeMembers !== undefined && (
            <div>
              <dt>Personas que lo usaron</dt>
              <dd>{formatNumber(p.activeMembers)}</dd>
            </div>
          )}
        </dl>
      </section>
      {p.totals.analyses === 0 ? (
        <p className="muted">No hay análisis en este período.</p>
      ) : (
        <section className="card stack" aria-labelledby="por-dia">
          <h2 id="por-dia">{GRAIN_TITLE[grain]}</h2>
          <DailyChart p={p} buckets={buckets} title={GRAIN_TITLE[grain]} />
          <details>
            <summary>Ver los datos en una tabla</summary>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">{GRAIN_TITLE[grain]}</caption>
                <thead>
                  <tr>
                    <th scope="col">{grain === "day" ? "Día" : grain === "week" ? "Semana" : "Mes"}</th>
                    <th scope="col">Analizados</th>
                    <th scope="col">Con humo</th>
                    <th scope="col">Sin humo</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.filter((d) => d.analyses > 0).map((d) => (
                    <tr key={d.key}>
                      <th scope="row">{grain === "day" ? formatDate(`${d.key}T12:00:00Z`) : d.label}</th>
                      <td>{formatNumber(d.analyses)}</td>
                      <td>{formatNumber(d.withSmoke)}</td>
                      <td>{formatNumber(d.analyses - d.withSmoke)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="muted">
            En el período: {formatNumber(p.totals.withSmoke)} con humo y {formatNumber(clean)} sin humo.
          </p>
        </section>
      )}
      <div className="grid-2">
        {table("Tipos de humo", p.smokeTypes.map((x) => [SMOKE_LABELS[x.type as keyof typeof SMOKE_LABELS] ?? x.type, x.count]))}
        {table("Por dónde llegaron", p.channels.map((x) => [CHANNEL_NAMES[x.channel] ?? x.channel, x.count]))}
      </div>
      {table("Temas", p.topics.map((x) => [x.topic, x.count]))}
    </div>
  );
}

/**
 * Columnas apiladas por día: "con humo" apoyada en la base (es lo que importa) y "sin humo" arriba.
 * Colores de gráfico validados (--chart-*), 2 px de separación entre segmentos, extremo redondeado,
 * grilla discreta y un aviso al pasar el mouse. La tabla de arriba tiene los mismos datos.
 */
function DailyChart({ p, buckets, title }: { p: UsagePanel; buckets: Bucket[]; title: string }) {
  const [hover, setHover] = useState<number>();
  const W = 720;
  const H = 220;
  const pad = { l: 40, r: 8, t: 10, b: 26 };
  const days = buckets;
  const max = Math.max(1, ...days.map((d) => d.analyses));
  const step = (W - pad.l - pad.r) / days.length;
  const bw = Math.max(2, Math.min(22, step - 2));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const ticks = [0, Math.round(max / 2), max];
  const labelEvery = Math.ceil(days.length / 6);
  const r = Math.min(4, bw / 2);
  const hd = hover === undefined ? undefined : days[hover];
  return (
    <div className="stack" style={{ gap: "var(--space-2)" }}>
      <div className="row" aria-hidden="true">
        <span className="row" style={{ gap: "var(--space-1)" }}>
          <span className="swatch" style={{ background: "var(--chart-smoke)" }} /> Con humo
        </span>
        <span className="row" style={{ gap: "var(--space-1)" }}>
          <span className="swatch" style={{ background: "var(--chart-clean)" }} /> Sin humo
        </span>
      </div>
      <div style={{ position: "relative" }}>
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${formatNumber(p.totals.analyses)} en total, ${pct(p.totals.smokeRate)} con humo. Los datos están en la tabla.`} onMouseLeave={() => setHover(undefined)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="chart__grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
              <text className="chart__axis" x={pad.l - 6} y={y(t) + 4} textAnchor="end">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = pad.l + i * step + (step - bw) / 2;
            const smokeTop = y(d.withSmoke);
            const totalTop = y(d.analyses);
            const base = y(0);
            const cleanH = smokeTop - totalTop;
            return (
              <g key={d.key} opacity={hover === undefined || hover === i ? 1 : 0.55}>
                {d.withSmoke > 0 && <path d={roundedTop(x, smokeTop, bw, base - smokeTop, cleanH > 1 ? 0 : r)} fill="var(--chart-smoke)" />}
                {cleanH > 1 && <path d={roundedTop(x, totalTop, bw, Math.max(0, cleanH - 2), r)} fill="var(--chart-clean)" />}
                {i % labelEvery === 0 && (
                  <text className="chart__axis" x={x + bw / 2} y={H - 8} textAnchor="middle">
                    {d.label}
                  </text>
                )}
                <rect x={pad.l + i * step} y={pad.t} width={step} height={H - pad.t - pad.b} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
        {hd && (
          <div className="chart-tip" style={{ left: `${((pad.l + (hover! + 0.5) * step) / W) * 100}%` }} aria-hidden="true">
            <strong>{hd.label}</strong>
            <span>{formatNumber(hd.analyses)} analizados</span>
            <span>
              <span className="swatch" style={{ background: "var(--chart-smoke)" }} /> {formatNumber(hd.withSmoke)} con humo
            </span>
            <span>
              <span className="swatch" style={{ background: "var(--chart-clean)" }} /> {formatNumber(hd.analyses - hd.withSmoke)} sin humo
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Rectángulo con las esquinas de arriba redondeadas (el extremo del dato), apoyado abajo. */
function roundedTop(x: number, top: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, h, w / 2);
  return `M${x},${top + h}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${top + h}Z`;
}

function Exports({ scope, from, to, canExport }: { scope: "user" | "organization"; from: string; to: string; canExport: boolean }) {
  const api = useApi();
  if (!canExport) {
    return (
      <div className="card">
        <p>
          Exportar a Excel, CSV o PDF viene con el plan Profesional. <Link to="/planes">Ver planes</Link>
        </p>
      </div>
    );
  }
  return (
    <section className="card stack" aria-labelledby="exportar">
      <h2 id="exportar">Exportar</h2>
      <div className="row">
        <span>Estas estadísticas:</span>
        {FORMATS.map(([f, label]) => (
          <a key={f} className="btn btn--secondary btn--small" href={api.exportUrl("usage_panel", f, { scope, from, to })} download>
            {label}
            {" "}<span className="visually-hidden">(estadísticas)</span>
          </a>
        ))}
      </div>
      <div className="row">
        <span>Mi historial de análisis:</span>
        {FORMATS.map(([f, label]) => (
          <a key={f} className="btn btn--ghost btn--small" href={api.exportUrl("analysis_history", f)} download>
            {label}
            {" "}<span className="visually-hidden">(historial)</span>
          </a>
        ))}
      </div>
    </section>
  );
}

const FREQ: Record<string, string> = { weekly: "cada semana", monthly: "cada mes" };

function Schedules({ canOrg }: { canOrg: boolean }) {
  const api = useApi();
  const { me } = useSession();
  const list = useAsync(() => api.reportSchedules(), [api]);
  const myMail = me?.channels.find((c) => c.type === "email" && c.verified)?.address ?? "";
  const [name, setName] = useState("Resumen de uso");
  const [frequency, setFrequency] = useState<"weekly" | "monthly">("weekly");
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [scope, setScope] = useState<"user" | "organization">("user");
  const [recipients, setRecipients] = useState(myMail);
  const create = useAction(async () => {
    const r = await api.createReportSchedule({ name: name.trim(), kind: "usage_panel", scope, format, frequency, recipients: recipients.split(/[\s,;]+/).filter(Boolean) });
    list.setData([r, ...(list.data ?? [])]);
    return r;
  });
  const remove = useAction(async (id: string) => {
    await api.deleteReportSchedule(id);
    list.setData((list.data ?? []).filter((x) => x.id !== id));
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && recipients.trim()) void create.run();
  };
  return (
    <section className="card stack" aria-labelledby="programados">
      <h2 id="programados">Reportes por mail</h2>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="grid-2">
          <Field label="Nombre">{(p) => <input {...p} className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Cada cuánto">
            {(p) => (
              <select {...p} className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as "weekly" | "monthly")}>
                <option value="weekly">Cada semana</option>
                <option value="monthly">Cada mes</option>
              </select>
            )}
          </Field>
          <Field label="Formato">
            {(p) => (
              <select {...p} className="select" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                {FORMATS.map(([f, l]) => (
                  <option key={f} value={f}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {canOrg && (
            <Field label="Estadísticas de">
              {(p) => (
                <select {...p} className="select" value={scope} onChange={(e) => setScope(e.target.value as "user" | "organization")}>
                  <option value="user">Mías</option>
                  <option value="organization">Toda mi organización</option>
                </select>
              )}
            </Field>
          )}
        </div>
        <Field label="Mandarlo a" hint="Mails verificados tuyos o de tu organización, separados por coma.">
          {(p) => <input {...p} className="input" value={recipients} onChange={(e) => setRecipients(e.target.value)} />}
        </Field>
        <div className="row">
          <button className="btn" type="submit" disabled={create.pending || !name.trim() || !recipients.trim()}>
            Programar
          </button>
        </div>
        <ErrorAlert error={create.error} />
        {create.result && !create.pending && (
          <Notice tone="ok">
            <p>Listo: el primero sale el {formatDate(create.result.nextRunAt)}.</p>
          </Notice>
        )}
      </form>
      {list.data && list.data.length > 0 && (
        <ul className="plain-list stack">
          {list.data.map((s) => (
            <li key={s.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <strong>{s.name}</strong>{" "}
                <span className="muted">
                  · {FREQ[s.frequency]} · {s.format.toUpperCase()} · a {s.recipients.join(", ")} · próximo: {formatDateTime(s.nextRunAt)}
                  {s.lastError && ` · el último falló: ${s.lastError}`}
                </span>
              </span>
              <button className="btn btn--ghost btn--small" type="button" onClick={() => void remove.run(s.id)} disabled={remove.pending} aria-label={`Borrar el reporte ${s.name}`}>
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorAlert error={remove.error} />
    </section>
  );
}

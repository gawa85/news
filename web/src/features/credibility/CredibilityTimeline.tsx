import { useId, useState } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { TimelinePoint } from "../../api/types";
import { credibilityVerdict, formatDate } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field } from "../../ui/components";
import { useAction } from "../../ui/useAsync";

const pct = (s: number | null) => (s === null ? "—" : `${Math.round(s * 100)}`);

/**
 * EVOLUCIÓN de la credibilidad del medio elegido, en períodos iguales.
 * Gráfico para ver la tendencia y tabla con los mismos datos (la tabla es lo que lee un lector de pantalla).
 */
export function CredibilityTimeline({ query }: { query: { outletId: string; topic: string; from: string; to: string } }) {
  const api = useApi();
  const { can } = useSession();
  const [windows, setWindows] = useState(6);
  const run = useAction(() => api.credibilityTimeline({ ...query, windows }));

  if (!can("credibility_timeline")) {
    return (
      <div className="card card--flat">
        <p>
          ¿Querés ver cómo cambió en el tiempo? La evolución de la credibilidad viene con el plan Profesional. <Link to="/planes">Ver planes</Link>
        </p>
      </div>
    );
  }

  return (
    <section className="card stack" aria-labelledby="evolucion">
      <h2 id="evolucion">Evolución en el tiempo</h2>
      <div className="row">
        <Field label="Cantidad de períodos">
          {(p) => (
            <select {...p} className="select" value={windows} onChange={(e) => setWindows(Number(e.target.value))}>
              {[3, 4, 6, 8, 12].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
        <button className="btn btn--secondary" type="button" onClick={() => void run.run()} disabled={run.pending} style={{ alignSelf: "end" }}>
          {run.pending ? "Calculando…" : "Ver la evolución"}
        </button>
      </div>
      <ErrorAlert error={run.error} />
      {run.result && <TimelineView points={run.result} />}
    </section>
  );
}

function TimelineView({ points }: { points: TimelinePoint[] }) {
  const captionId = useId();
  const dimensions = points[0]?.report.dimensions.map((d) => ({ id: d.dimensionId, label: d.label })) ?? [];
  const known = points.map((p) => p.report.overall).filter((s): s is number => s !== null);
  const first = known[0];
  const last = known.at(-1);
  const trend =
    first === undefined || last === undefined || known.length < 2
      ? "No hay datos suficientes en varios períodos para ver una tendencia."
      : Math.abs(last - first) < 0.05
        ? `Se mantuvo estable (de ${pct(first)} a ${pct(last)} sobre 100).`
        : `${last > first ? "Subió" : "Bajó"} de ${pct(first)} a ${pct(last)} sobre 100.`;

  return (
    <div className="stack">
      <p aria-live="polite">
        <strong>{trend}</strong>
      </p>
      <Chart points={points} describedBy={captionId} />
      <div className="table-wrap">
        <table className="table">
          <caption id={captionId}>Credibilidad por período (0 a 100)</caption>
          <thead>
            <tr>
              <th scope="col">Período</th>
              <th scope="col">General</th>
              <th scope="col">Notas</th>
              {dimensions.map((d) => (
                <th key={d.id} scope="col">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.period.from}>
                <th scope="row">
                  {formatDate(p.period.from)} – {formatDate(p.period.to)}
                </th>
                <td>
                  {pct(p.report.overall)} <span className="muted">({credibilityVerdict(p.report.overall)})</span>
                </td>
                <td>{p.report.sampleSize}</td>
                {dimensions.map((d) => (
                  <td key={d.id}>{pct(p.report.dimensions.find((x) => x.dimensionId === d.id)?.score ?? null)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Línea del puntaje general. Los períodos sin datos cortan la línea (no se inventa un valor). */
function Chart({ points, describedBy }: { points: TimelinePoint[]; describedBy: string }) {
  const W = 640;
  const H = 220;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (s: number) => pad.t + (1 - s) * (H - pad.t - pad.b);
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    const s = p.report.overall;
    if (s === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(s).toFixed(1)}`;
  });
  if (current) segments.push(current);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gráfico de la credibilidad general por período" aria-describedby={describedBy}>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line className="chart__grid" x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} />
          <text className="chart__axis" x={pad.l - 6} y={y(g) + 4} textAnchor="end">
            {g * 100}
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <text key={p.period.from} className="chart__axis" x={x(i)} y={H - 8} textAnchor={points.length > 1 && i === 0 ? "start" : points.length > 1 && i === points.length - 1 ? "end" : "middle"}>
          {new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit" }).format(new Date(p.period.from))}
        </text>
      ))}
      {segments.map((d) => (
        <path key={d} className="chart__line" d={d} />
      ))}
      {points.map((p, i) => (p.report.overall === null ? null : <circle key={p.period.from} className="chart__dot" cx={x(i)} cy={y(p.report.overall)} r={4} />))}
    </svg>
  );
}

import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { CredibilityReport } from "../../api/types";
import { credibilityVerdict, formatDate } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, ScoreBar } from "../../ui/components";
import { useAction } from "../../ui/useAsync";
import { isoDay, TopicSuggestions, useOutlets, useTopics } from "../shared/catalog";
import { CredibilityTimeline } from "./CredibilityTimeline";

/** CREDIBILIDAD de un medio en un tema: por dimensiones (precisión, fuentes, conflictos de interés, pauta…). */
export function CredibilityPage() {
  const api = useApi();
  const { can } = useSession();
  const { list } = useOutlets();
  const topics = useTopics();
  const [params] = useSearchParams();
  const [outletId, setOutletId] = useState(() => params.get("medio")?.slice(0, 100) ?? "");
  const [topic, setTopic] = useState(() => params.get("tema")?.slice(0, 100) ?? "");
  const [from, setFrom] = useState(isoDay(365));
  const [to, setTo] = useState(isoDay(0));
  const query = { outletId, topic: topic.trim(), from: new Date(`${from}T00:00:00-03:00`).toISOString(), to: new Date(`${to}T23:59:59-03:00`).toISOString() };
  // Lo que se pidió (la evolución usa lo mismo aunque después se edite el formulario).
  const [asked, setAsked] = useState<typeof query>();
  const run = useAction(() => api.credibility(query));

  if (!can("credibility_meter")) {
    return (
      <Page title="Credibilidad de los medios" lead="Cuánto confiar en un medio en un tema: precisión, fuentes, conflictos de interés y pauta oficial.">
        <div className="card">
          <p>El medidor de credibilidad viene con el plan Personal o superior.</p>
          <Link className="btn" to="/planes">
            Ver planes
          </Link>
        </div>
      </Page>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (outletId && topic.trim()) {
      setAsked(query);
      void run.run();
    }
  };

  return (
    <Page title="Credibilidad de los medios" lead="Elegí un medio y un tema. La credibilidad cambia según el tema: un diario puede ser preciso en deportes y no en economía.">
      <p style={{ margin: 0 }}>
        <Link to="/credibilidad/panorama">Ver todos los medios juntos</Link>
      </p>
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="grid-2">
          <Field label="Medio">
            {(p) => (
              <select {...p} className="select" required value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                <option value="">Elegí un medio…</option>
                {list.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Tema">{(p) => <input {...p} className="input" list="temas-cred" required value={topic} onChange={(e) => setTopic(e.target.value)} />}</Field>
        </div>
        <TopicSuggestions id="temas-cred" topics={topics} />
        <div className="grid-2">
          <Field label="Desde">{(p) => <input {...p} className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="Hasta">{(p) => <input {...p} className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={run.pending || !outletId || !topic.trim()}>
            {run.pending ? "Calculando…" : "Ver credibilidad"}
          </button>
        </div>
      </form>
      <ErrorAlert error={run.error} />
      {run.result && <ReportView r={run.result} />}
      {run.result && asked && <CredibilityTimeline key={JSON.stringify(asked)} query={asked} />}
    </Page>
  );
}

export const VERIFICATION_LABELS: Record<"verified" | "corroborated" | "unverified", string> = {
  verified: "Verificado por personas",
  corroborated: "Cotejado con otros medios",
  unverified: "Sin corroborar",
};

function ReportView({ r }: { r: CredibilityReport }) {
  return (
    <section aria-labelledby="informe" className="stack" aria-live="polite">
      <h2 id="informe">{r.outletName}</h2>
      <div className="card stack">
        {r.verification?.status === "unverified" ? (
          <Notice tone="info" title="Sin puntaje general: todavía no hay datos corroborados">
            <p>{r.verification.note}</p>
          </Notice>
        ) : (
          <>
            <ScoreBar score={r.overall} label={`Credibilidad general: ${credibilityVerdict(r.overall)}`} />
            {r.verification && <p style={{ margin: 0 }}>{VERIFICATION_LABELS[r.verification.status]}. {r.verification.note}</p>}
          </>
        )}
        <p className="muted" style={{ margin: 0 }}>
          Basado en {r.sampleSize} notas. {r.disclaimer}
        </p>
      </div>
      <div className="grid-2">
        {r.dimensions.map((d) => (
          <div key={d.dimensionId} className="card card--flat stack">
            <ScoreBar score={d.score} label={d.label} />
            <p>{d.summary}</p>
            <p className="muted">Confianza en el cálculo: {Math.round(d.confidence * 100)}%</p>
            {d.evidence.length > 0 && (
              <details>
                <summary>Ver evidencia ({d.evidence.length})</summary>
                <ul>
                  {d.evidence.map((e, i) => (
                    <li key={i}>
                      {e.url ? (
                        <a href={e.url} target="_blank" rel="noopener noreferrer">
                          {e.description}
                        </a>
                      ) : (
                        e.description
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
      {(r.corrections.length > 0 || r.rebuttals.length > 0) && (
        <div className="card">
          <h3>Derecho a réplica y fe de erratas</h3>
          <ul>
            {r.corrections.map((c) => (
              <li key={c.id}>
                Fe de erratas ({formatDate(c.publishedAt)}): {c.description}
              </li>
            ))}
            {r.rebuttals.map((x) => (
              <li key={x.id}>
                Réplica del medio ({x.status}): {x.statement}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { CredibilityOverview } from "../../api/types";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Page } from "../../ui/components";
import { useAction } from "../../ui/useAsync";
import { isoDay, TopicSuggestions, useTopics } from "../shared/catalog";
import { VERIFICATION_LABELS } from "./CredibilityPage";

/** Las columnas que se comparan de un vistazo (el detalle está en la ficha de cada medio). */
const COLUMNS = [
  { id: "accuracy", label: "Verificado" },
  { id: "corroboration", label: "Cotejo con otros medios" },
  { id: "sourcing", label: "Cita fuentes" },
  { id: "language", label: "Sin humo" },
];

/** Por debajo de esto, el número sale de muy pocos datos (por ejemplo, se cotejó el 1 % de lo publicado). */
const LOW_CONFIDENCE = 0.3;

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n * 100)}/100`);

/**
 * PANORAMA: todos los medios juntos, y los datos más repetidos que nadie verificó.
 * Que un dato esté en muchas notas no lo hace cierto: es por donde conviene empezar a corroborar.
 */
export function CredibilityOverviewPage() {
  const api = useApi();
  const { can, has } = useSession();
  const topics = useTopics();
  const [topic, setTopic] = useState("");
  const [from, setFrom] = useState(isoDay(30));
  const [to, setTo] = useState(isoDay(0));
  const run = useAction(() =>
    api.credibilityOverview({
      topic: topic.trim() || undefined,
      from: new Date(`${from}T00:00:00-03:00`).toISOString(),
      to: new Date(`${to}T23:59:59-03:00`).toISOString(),
    }),
  );

  if (!can("credibility_meter")) {
    return (
      <Page title="Panorama de credibilidad" lead="Todos los medios juntos: cuánto de lo que publican está corroborado.">
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
    void run.run();
  };

  return (
    <Page title="Panorama de credibilidad" lead="Todos los medios juntos. Que una nota traiga cifras no quiere decir que sean ciertas: acá ves cuánto de lo que publica cada medio está corroborado.">
      <p style={{ margin: 0 }}>
        <Link to="/credibilidad">← Ver un medio en detalle</Link>
      </p>
      <form className="card stack" onSubmit={submit} noValidate>
        <Field label="Tema (opcional)" hint="Vacío: todos los temas.">
          {(p) => <input {...p} className="input" list="temas-panorama" value={topic} onChange={(e) => setTopic(e.target.value)} />}
        </Field>
        <TopicSuggestions id="temas-panorama" topics={topics} />
        <div className="grid-2">
          <Field label="Desde">{(p) => <input {...p} className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="Hasta">{(p) => <input {...p} className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={run.pending}>
            {run.pending ? "Calculando…" : "Ver panorama"}
          </button>
        </div>
      </form>
      <ErrorAlert error={run.error} />
      {run.result && <OverviewView o={run.result} canVerify={has("verdicts:write")} />}
    </Page>
  );
}

function OverviewView({ o, canVerify }: { o: CredibilityOverview; canVerify: boolean }) {
  const topicParam = o.query.topic ? `&tema=${encodeURIComponent(o.query.topic)}` : "";
  const unverified = o.rows.filter((r) => r.verification.status === "unverified").length;
  return (
    <div className="stack" aria-live="polite">
      <section className="card stack" aria-labelledby="panorama-resumen">
        <h2 id="panorama-resumen">{o.query.topic ? `Sobre «${o.query.topic}»` : "Todos los temas"}</h2>
        <p style={{ margin: 0 }}>
          {o.totals.articles} notas de {o.rows.length} medio{o.rows.length === 1 ? "" : "s"}, con {o.totals.factClaims} datos. Verificados por personas:{" "}
          <strong>{o.totals.verifiedClaims}</strong>.
        </p>
        {unverified > 0 && (
          <p className="muted" style={{ margin: 0 }}>
            {unverified} de {o.rows.length} medios no tienen puntaje general: todavía no hay datos suyos corroborados. No quiere decir que mientan, sino que falta comprobarlo.
          </p>
        )}
      </section>

      {o.rows.length === 0 ? (
        <p>No hay notas de ningún medio en ese período{o.query.topic ? " sobre ese tema" : ""}.</p>
      ) : (
        <section className="stack" aria-labelledby="panorama-medios">
          <h2 id="panorama-medios">Medios</h2>
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Credibilidad de cada medio: estado de verificación y puntajes (de 0 a 100)</caption>
              <thead>
                <tr>
                  <th scope="col">Medio</th>
                  <th scope="col">Notas</th>
                  <th scope="col">Estado</th>
                  <th scope="col">General</th>
                  {COLUMNS.map((c) => (
                    <th key={c.id} scope="col">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.rows.map((r) => (
                  <tr key={r.outletId}>
                    <th scope="row">
                      <Link to={`/credibilidad?medio=${encodeURIComponent(r.outletId)}${topicParam}`}>{r.outletName}</Link>
                    </th>
                    <td>{r.articles}</td>
                    <td>
                      <span className={`badge ${r.verification.status === "unverified" ? "badge--neutral" : "badge--fact"}`}>{VERIFICATION_LABELS[r.verification.status]}</span>
                    </td>
                    <td>{r.verification.status === "unverified" ? "sin puntaje" : pct(r.overall)}</td>
                    {COLUMNS.map((c) => {
                      const d = r.dimensions.find((x) => x.dimensionId === c.id);
                      return (
                        <td key={c.id}>
                          {pct(d?.score)}
                          {d && d.score !== null && d.confidence < LOW_CONFIDENCE && <span className="muted"> (pocos datos)</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            «—» es que no hay datos para medirlo; «pocos datos», que el número sale de una parte chica de lo publicado. «Cita fuentes» y «Sin humo» miden cómo está escrita la nota, no si lo que dice es cierto. Tocá un medio para ver de dónde sale cada número.
          </p>
        </section>
      )}

      <section className="card stack" aria-labelledby="panorama-verificar">
        <h2 id="panorama-verificar">Datos repetidos que nadie verificó</h2>
        <p className="muted" style={{ margin: 0 }}>
          Los publican varios medios, pero que muchos lo digan no lo hace cierto (a veces todos copian la misma fuente). Por acá conviene empezar a corroborar.
        </p>
        {o.toVerify.length === 0 ? (
          <p style={{ margin: 0 }}>No hay datos con cifras que se repitan entre medios en este período.</p>
        ) : (
          <ul className="plain-list stack">
            {o.toVerify.map((c, i) => (
              <li key={i} className="card card--flat stack">
                <p style={{ margin: 0 }}>«{c.text}»</p>
                <p className="muted" style={{ margin: 0 }}>
                  Lo publican {c.outlets.length} medios: {c.outlets.join(", ")}.
                  {c.conflicting && (
                    <>
                      {" "}
                      <span className="badge badge--smoke">No dan la misma cifra</span>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canVerify && (
          <p style={{ margin: 0 }}>
            <Link to="/admin/verificacion">Ir a Verificación</Link> para cargar lo que se compruebe.
          </p>
        )}
      </section>
    </div>
  );
}

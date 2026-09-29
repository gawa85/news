import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { EvaluationMetrics, ExampleLabel, LabeledExample, ModelVersion } from "../../api/backofficeTypes";
import type { SmokeType } from "../../api/types";
import { formatDate, SMOKE_LABELS } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const pct = (n: number | undefined) => (n === undefined ? "—" : `${Math.round(n * 100)} %`);
const STATUS: Record<ModelVersion["status"], string> = { active: "En uso", candidate: "Candidata", retired: "Retirada" };
const ENGINE: Record<ModelVersion["engine"], string> = { rules: "Reglas", llm: "Modelo de lenguaje" };

/**
 * CALIDAD DEL ALGORITMO: ejemplos etiquetados, revisión de lo que llegó por "no me sirvió",
 * evaluación de la versión en uso y promoción de una candidata (sólo si mide mejor).
 */
export function QualityPage() {
  const api = useBackoffice();
  const data = useAsync(() => api.quality(), [api]);
  const q = data.data;
  const reload = () => void data.reload();
  return (
    <Page title="Calidad del algoritmo" lead="Una versión nueva sólo entra en uso si, con los mismos ejemplos revisados, mide mejor que la actual.">
      {data.loading && !q && <Spinner />}
      <ErrorAlert error={data.error} />
      {q && (
        <>
          <section className="card stack" aria-labelledby="versiones">
            <h2 id="versiones">Versiones</h2>
            <p className="muted" style={{ margin: 0 }}>
              En uso: <span className="mono">{q.current}</span> · {q.reviewedExamples} ejemplos revisados
            </p>
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Versiones del algoritmo y sus mediciones</caption>
                <thead>
                  <tr>
                    <th scope="col">Versión</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Aciertos</th>
                    <th scope="col">Precisión</th>
                    <th scope="col">Exhaustividad</th>
                    <th scope="col">F1</th>
                    <th scope="col">Le sirvió a la gente</th>
                    <th scope="col">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {q.versions.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted">
                        Todavía no hay mediciones: medí la versión en uso para empezar a comparar.
                      </td>
                    </tr>
                  )}
                  {q.versions.map((v) => (
                    <VersionRow key={v.id} v={v} usefulness={q.usefulness[v.id]} onPromoted={reload} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Precisión: de lo que marcó como humo, cuánto lo era. Exhaustividad: del humo que había, cuánto encontró.
            </p>
          </section>
          <Evaluate onDone={reload} />
          <section className="card stack" aria-labelledby="por-revisar">
            <h2 id="por-revisar">Por revisar ({q.pendingReview.length})</h2>
            <p className="muted" style={{ margin: 0 }}>
              Llegan de quienes marcaron "no me sirvió". No cuentan para medir hasta que alguien del equipo confirma la etiqueta.
            </p>
            {q.pendingReview.length === 0 && <p className="muted">No hay ejemplos pendientes.</p>}
            <ul className="plain-list stack">
              {q.pendingReview.map((ex) => (
                <ReviewItem key={ex.id} ex={ex} onDone={reload} />
              ))}
            </ul>
          </section>
          <section className="card stack" aria-labelledby="nuevo-ejemplo">
            <h2 id="nuevo-ejemplo">Nuevo ejemplo</h2>
            <NewExample onDone={reload} />
          </section>
        </>
      )}
    </Page>
  );
}

function VersionRow({ v, usefulness, onPromoted }: { v: ModelVersion; usefulness?: { total: number; rate: number }; onPromoted: () => void }) {
  const api = useBackoffice();
  const promote = useAction(async () => {
    await api.promote(v.id);
    onPromoted();
  });
  const m = v.lastEvaluation;
  return (
    <tr>
      <th scope="row">
        <span className="mono">{v.id}</span>
        <br />
        <span className="muted">
          {ENGINE[v.engine]} · {v.description}
        </span>
      </th>
      <td>{STATUS[v.status]}</td>
      <td>{pct(m?.accuracy)}</td>
      <td>{pct(m?.precision)}</td>
      <td>{pct(m?.recall)}</td>
      <td>{pct(m?.f1)}</td>
      <td>{usefulness ? `${pct(usefulness.rate)} de ${usefulness.total}` : "—"}</td>
      <td>
        {v.status === "candidate" && (
          <button className="btn btn--small" type="button" aria-label={`Poner en uso ${v.id}`} disabled={promote.pending || !m} onClick={() => void promote.run()}>
            Poner en uso
          </button>
        )}
        <ErrorAlert error={promote.error} />
      </td>
    </tr>
  );
}

function Evaluate({ onDone }: { onDone: () => void }) {
  const api = useBackoffice();
  const run = useAction(async () => {
    const r = await api.evaluate();
    onDone();
    return r;
  });
  const r = run.result;
  return (
    <section className="card stack" aria-labelledby="evaluar">
      <h2 id="evaluar">Medir la versión en uso</h2>
      <div className="row">
        <button className="btn btn--small" type="button" disabled={run.pending} onClick={() => void run.run()}>
          {run.pending ? "Midiendo…" : "Medir con los ejemplos revisados"}
        </button>
      </div>
      <ErrorAlert error={run.error} />
      {r && (
        <div className="stack">
          <p style={{ margin: 0 }}>
            <span className="mono">{r.modelVersion}</span> con {r.metrics.examples} ejemplos: aciertos {pct(r.metrics.accuracy)}, precisión {pct(r.metrics.precision)}, exhaustividad {pct(r.metrics.recall)}.
          </p>
          <PerType metrics={r.metrics} />
          {r.failures.length > 0 && (
            <details>
              <summary>{r.failures.length} ejemplo(s) donde se equivocó</summary>
              <ul>
                {r.failures.map((f) => (
                  <li key={f.exampleId}>
                    <span className="mono">{f.exampleId}</span>: se esperaba {f.expected.isSmoke ? `humo (${f.expected.types.map((t) => SMOKE_LABELS[t]).join(", ") || "sin tipo"})` : "sin humo"}; dio{" "}
                    {f.got.isSmoke ? `humo (${f.got.types.map((t) => SMOKE_LABELS[t]).join(", ") || "sin tipo"})` : "sin humo"}.
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function PerType({ metrics }: { metrics: EvaluationMetrics }) {
  const rows = Object.entries(metrics.perType) as [SmokeType, { precision: number; recall: number; support: number }][];
  if (!rows.length) return null;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption>Por tipo de humo</caption>
        <thead>
          <tr>
            <th scope="col">Tipo</th>
            <th scope="col">Precisión</th>
            <th scope="col">Exhaustividad</th>
            <th scope="col">Ejemplos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([t, m]) => (
            <tr key={t}>
              <th scope="row">{SMOKE_LABELS[t]}</th>
              <td>{pct(m.precision)}</td>
              <td>{pct(m.recall)}</td>
              <td>{m.support}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Etiqueta: ¿tiene humo? y de qué tipos. `context` distingue cada grupo para lectores de pantalla. */
function LabelFields({ value, onChange, name, context }: { value: ExampleLabel; onChange: (v: ExampleLabel) => void; name: string; context: string }) {
  const toggle = (t: SmokeType, on: boolean) => onChange({ ...value, types: on ? [...value.types, t] : value.types.filter((x) => x !== t) });
  return (
    <fieldset className="stack">
      <legend>
        ¿Tiene humo?{" "}
        <span className="visually-hidden">({context})</span>
      </legend>
      <div className="row">
        <label className="row">
          <input type="radio" name={`humo-${name}`} checked={value.isSmoke} onChange={() => onChange({ ...value, isSmoke: true })} />
          Sí
        </label>
        <label className="row">
          <input type="radio" name={`humo-${name}`} checked={!value.isSmoke} onChange={() => onChange({ isSmoke: false, types: [] })} />
          No
        </label>
      </div>
      {value.isSmoke && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          {(Object.keys(SMOKE_LABELS) as SmokeType[]).map((t) => (
            <label key={t} className="row">
              <input type="checkbox" checked={value.types.includes(t)} onChange={(e) => toggle(t, e.target.checked)} />
              {SMOKE_LABELS[t]}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function ReviewItem({ ex, onDone }: { ex: LabeledExample; onDone: () => void }) {
  const api = useBackoffice();
  const [label, setLabel] = useState<ExampleLabel>(ex.expected);
  const review = useAction(async () => {
    await api.reviewExample(ex.id, label);
    onDone();
  });
  return (
    <li className="card card--flat stack">
      <blockquote style={{ margin: 0 }}>{ex.text}</blockquote>
      <p className="muted" style={{ margin: 0 }}>
        Llegó el {formatDate(ex.addedAt)}
        {ex.note && ` · «${ex.note}»`}
      </p>
      <LabelFields value={label} onChange={setLabel} name={ex.id} context={`«${ex.text.slice(0, 40)}»`} />
      <div className="row">
        <button className="btn btn--small" type="button" aria-label={`Confirmar etiqueta de ${ex.id}`} disabled={review.pending} onClick={() => void review.run()}>
          Confirmar etiqueta
        </button>
      </div>
      <ErrorAlert error={review.error} />
    </li>
  );
}

function NewExample({ onDone }: { onDone: () => void }) {
  const api = useBackoffice();
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [label, setLabel] = useState<ExampleLabel>({ isSmoke: true, types: [] });
  const add = useAction(async () => {
    await api.addExample(text.trim(), label, note.trim() || undefined);
    setText("");
    setNote("");
    onDone();
    return true;
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) void add.run();
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label="Texto del ejemplo">{(p) => <textarea {...p} className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      <LabelFields value={label} onChange={setLabel} name="nuevo" context="ejemplo nuevo" />
      <Field label="Nota (opcional)" hint="Por qué es un buen ejemplo.">
        {(p) => <input {...p} className="input" value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className="row">
        <button className="btn btn--small" type="submit" disabled={add.pending || !text.trim()}>
          Agregar ejemplo
        </button>
      </div>
      <ErrorAlert error={add.error} />
      {add.result && (
        <Notice tone="ok">
          <p>Ejemplo agregado (ya cuenta como revisado).</p>
        </Notice>
      )}
    </form>
  );
}

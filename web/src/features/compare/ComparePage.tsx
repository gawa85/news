import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { useApi } from "../../api/ApiContext";
import type { Comparison } from "../../api/types";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Page } from "../../ui/components";
import { useAction } from "../../ui/useAsync";
import { isoDay, TopicSuggestions, useOutlets, useTopics } from "../shared/catalog";

const DISAGREEMENT: Record<Comparison["disagreements"][number]["type"], string> = {
  factual: "Datos distintos",
  interpretive: "Misma información, distinta lectura",
  values: "Distintas prioridades",
};

/** COMPARAR FUENTES: qué dicen distintos medios sobre un tema, en qué coinciden, en qué no y qué omiten. */
export function ComparePage() {
  const api = useApi();
  const { me } = useSession();
  const topics = useTopics();
  const [params] = useSearchParams();
  const [topic, setTopic] = useState(() => params.get("tema")?.slice(0, 100) ?? "");
  const [from, setFrom] = useState(isoDay(30));
  const [to, setTo] = useState(isoDay(0));
  const [links, setLinks] = useState("");
  const maxLinks = me?.plan.limits.maxIncludeUrls ?? 0;
  const compare = useAction(() =>
    api.compare({
      topic: topic.trim(),
      from: new Date(`${from}T00:00:00-03:00`).toISOString(),
      to: new Date(`${to}T23:59:59-03:00`).toISOString(),
      include: links.split(/\s+/).filter((l) => /^https?:\/\//.test(l)),
    }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (topic.trim()) void compare.run();
  };

  return (
    <Page title="Comparar fuentes" lead="Elegí un tema y un período: te mostramos en qué coinciden los medios, en qué se contradicen y qué deja afuera cada uno.">
      <form className="card stack" onSubmit={submit} noValidate>
        <Field label="Tema" hint="Por ejemplo: tarifas de gas, inflación, elecciones.">
          {(p) => <input {...p} className="input" list="temas" required value={topic} onChange={(e) => setTopic(e.target.value)} />}
        </Field>
        <TopicSuggestions id="temas" topics={topics} />
        <div className="grid-2">
          <Field label="Desde">{(p) => <input {...p} className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="Hasta">{(p) => <input {...p} className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>
        {maxLinks > 0 ? (
          <Field label="Notas que querés sumar (opcional)" hint={`Pegá hasta ${maxLinks} links, uno por línea.`}>
            {(p) => <textarea {...p} className="textarea" style={{ minHeight: "5rem" }} value={links} onChange={(e) => setLinks(e.target.value)} />}
          </Field>
        ) : (
          <p className="muted">Con el plan Personal podés sumar tus propios links a la comparación.</p>
        )}
        <div className="row">
          <button className="btn" type="submit" disabled={compare.pending || !topic.trim()}>
            {compare.pending ? "Comparando…" : "Comparar"}
          </button>
        </div>
      </form>
      <ErrorAlert error={compare.error} />
      {compare.result && <ComparisonView c={compare.result} />}
    </Page>
  );
}

function ComparisonView({ c }: { c: Comparison }) {
  const { nameOf } = useOutlets();
  const sources = c.outletIds.map(nameOf).join(", ");
  return (
    <section aria-labelledby="comparacion" className="stack" aria-live="polite">
      <h2 id="comparacion">{c.topic}</h2>
      <p className="muted">
        {c.articleUrls.length} notas de {c.outletIds.length} fuentes: {sources || "ninguna"}.
      </p>
      {c.blockedIncludes.length > 0 && <p className="muted">No se usaron {c.blockedIncludes.length} links por tus reglas o por el plan.</p>}
      {c.urlRules.failedIncludes.length > 0 && (
        <p className="muted">No se pudieron leer: {c.urlRules.failedIncludes.map((f) => f.url).join(", ")}.</p>
      )}

      <div className="card">
        <h3>En qué coinciden</h3>
        {c.agreements.length === 0 ? (
          <p className="muted">No hay afirmaciones que repitan todas las fuentes.</p>
        ) : (
          <ul className="plain-list">
            {c.agreements.map((a) => (
              <li key={a.id} className="finding finding--fact">
                {a.summary} <span className="muted">({a.outletIds.map(nameOf).join(", ")})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {c.partialAgreements.length > 0 && (
        <div className="card">
          <h3>Lo dicen algunas</h3>
          <ul className="plain-list">
            {c.partialAgreements.map((a) => (
              <li key={a.id}>
                {a.summary} <span className="muted">({a.outletIds.map(nameOf).join(", ")})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h3>En qué se contradicen</h3>
        {c.disagreements.length === 0 ? (
          <p className="muted">No encontramos contradicciones.</p>
        ) : (
          <ul className="plain-list">
            {c.disagreements.map((d) => (
              <li key={d.clusterId} className="finding">
                <span className="badge badge--smoke">{DISAGREEMENT[d.type]}</span> {d.description}
                <ul>
                  {d.positions.map((p, i) => (
                    <li key={i}>
                      <strong>{nameOf(p.outletId)}:</strong> «{p.claimText}»
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>

      {c.omissions.length > 0 && (
        <div className="card">
          <h3>Qué deja afuera cada medio</h3>
          <ul>
            {c.omissions.map((o) => (
              <li key={o.outletId}>
                <strong>{nameOf(o.outletId)}</strong> no menciona {o.missingClusterIds.length} {o.missingClusterIds.length === 1 ? "tema que tratan otros" : "temas que tratan otros"}.
              </li>
            ))}
          </ul>
        </div>
      )}

      {c.openQuestions.length > 0 && (
        <div className="card">
          <h3>Preguntas abiertas</h3>
          <ul>
            {c.openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

import { useState } from "react";
import { useApi } from "../../api/ApiContext";
import type { Analysis } from "../../api/types";
import { formatDate, formatNumber, PLATFORM_NAMES, SMOKE_LABELS } from "../../domain/labels";
import { ErrorAlert, Notice, SmokeMeter } from "../../ui/components";
import { useAction } from "../../ui/useAsync";

const SIGNAL_BADGE = { ok: "badge--fact", info: "badge--neutral", warning: "badge--smoke", danger: "badge--danger" } as const;
const SIGNAL_WORD = { ok: "Bien", info: "Dato", warning: "Atención", danger: "Peligro" } as const;

/** Resultado de un análisis: índice, humo encontrado, datos concretos, versión limpia y señales de la fuente. */
export function AnalysisResult({ analysis }: { analysis: Analysis }) {
  const a = analysis;
  return (
    <section aria-labelledby="resultado" className="stack">
      <h2 id="resultado">Resultado</h2>

      {a.post && (
        <div className="card card--flat">
          <h3 className="card__title">📱 Publicación en {PLATFORM_NAMES[a.post.platform]}</h3>
          <p className="muted">
            {[a.post.author?.name, a.post.author?.handle].filter(Boolean).join(" ")}
            {a.post.publishedAt && ` · ${formatDate(a.post.publishedAt)}`}
            {a.post.metrics?.views !== undefined && ` · ${formatNumber(a.post.metrics.views)} vistas`}
          </p>
          <blockquote className="finding finding--fact">{a.text.length > 600 ? `${a.text.slice(0, 599)}…` : a.text}</blockquote>
          <a href={a.post.url} target="_blank" rel="noopener noreferrer">
            Ver la publicación original{" "}<span className="visually-hidden">(se abre en otra pestaña)</span>
          </a>
        </div>
      )}
      {a.postError && <Notice>{a.postError}</Notice>}

      <div className="grid-2">
        <div className="card">
          <h3>Índice de humo</h3>
          <SmokeMeter index={a.smokeIndex} />
        </div>
        <div className="card">
          <h3>Lo que queda sin humo</h3>
          {a.cleanVersion ? <p>{a.cleanVersion}</p> : <p className="muted">No quedan datos concretos: es todo humo o no trae hechos verificables.</p>}
        </div>
      </div>

      <div className="card">
        <h3>Humo encontrado {a.findings.length > 0 && <span className="badge badge--smoke">{a.findings.length}</span>}</h3>
        {a.findings.length === 0 ? (
          <p className="muted">No encontramos humo.</p>
        ) : (
          <ul className="plain-list">
            {a.findings.map((f, i) => (
              <li key={i} className="finding">
                <strong>{SMOKE_LABELS[f.type] ?? f.type}:</strong> <span className="finding__excerpt">«{f.excerpt}»</span>
                <br />
                <span className="muted">{f.explanation}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <h3>Datos concretos</h3>
        {a.facts.length === 0 ? (
          <p className="muted">No hay afirmaciones con datos concretos (quién, qué, cuándo, cuánto).</p>
        ) : (
          <ul className="plain-list">
            {a.facts.map((f, i) => (
              <li key={i} className="finding finding--fact">
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>

      {a.signals.length > 0 && (
        <div className="card">
          <h3>Sobre la fuente</h3>
          <ul className="plain-list">
            {a.signals.map((s) => (
              <li key={s.id}>
                <span className={`badge ${SIGNAL_BADGE[s.level]}`}>{SIGNAL_WORD[s.level]}</span> <strong>{s.label}</strong>
                <br />
                <span className="muted">{s.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Feedback analysisId={a.id} />
    </section>
  );
}

/** "¿Te sirvió?": ayuda a mejorar el algoritmo (los "no" los revisa el equipo). */
function Feedback({ analysisId }: { analysisId: string }) {
  const api = useApi();
  const [useful, setUseful] = useState<boolean>();
  const [reason, setReason] = useState("se_equivoco");
  const send = useAction(async (u: boolean, r?: string) => {
    await api.feedback(analysisId, u, r);
    return true;
  });
  if (send.result) {
    return <Notice tone="ok">{useful ? "¡Gracias! Nos ayuda a saber que vamos bien." : "Gracias por avisar: el equipo va a revisar este análisis para mejorar."}</Notice>;
  }
  return (
    <div className="card card--flat">
      <fieldset>
        <legend>¿Te sirvió este análisis?</legend>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={() => (setUseful(true), void send.run(true))} disabled={send.pending}>
            Sí, me sirvió
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => setUseful(false)} aria-expanded={useful === false}>
            No
          </button>
        </div>
        {useful === false && (
          <div className="stack" style={{ marginTop: "var(--space-4)" }}>
            <label className="field">
              <span className="field__label">¿Qué pasó?</span>
              <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="se_equivoco">Se equivocó</option>
                <option value="incompleto">Le faltó algo</option>
                <option value="no_entendi">No lo entendí</option>
                <option value="otro">Otra cosa</option>
              </select>
            </label>
            <button type="button" className="btn" onClick={() => void send.run(false, reason)} disabled={send.pending}>
              Enviar
            </button>
          </div>
        )}
        <ErrorAlert error={send.error} />
      </fieldset>
    </div>
  );
}

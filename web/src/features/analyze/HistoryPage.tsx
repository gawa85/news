import { Link, useParams } from "react-router";
import { useApi } from "../../api/ApiContext";
import { formatDateTime, smokeVerdict } from "../../domain/labels";
import { ErrorAlert, Page, Spinner } from "../../ui/components";
import { useAsync } from "../../ui/useAsync";
import type { AnalysisOrigin } from "../../api/types";
import { AnalysisResult } from "./AnalysisResult";

/** HISTORIAL: lo que analicé, del más nuevo al más viejo. */
export function HistoryPage() {
  const api = useApi();
  const list = useAsync(() => api.history(50), [api]);
  return (
    <Page title="Historial" lead="Lo que analizaste por la web, WhatsApp, Telegram o mail.">
      {list.loading && <Spinner />}
      <ErrorAlert error={list.error} />
      {list.data && list.data.length === 0 && (
        <p>
          Todavía no analizaste nada. <Link to="/analizar">Probá ahora</Link>.
        </p>
      )}
      {list.data && list.data.length > 0 && (
        <ul className="plain-list">
          {list.data.map((a) => {
            const v = smokeVerdict(a.smokeIndex);
            return (
              <li key={a.id} className="card card--flat">
                <div className="row">
                  <span className={`badge badge--${v.tone}`}>
                    {a.smokeIndex}/100 · {v.label}
                  </span>
                  <span className="muted">{formatDateTime(a.at)}</span>
                </div>
                <p style={{ marginTop: "var(--space-2)" }}>
                  <Link to={`/historial/${encodeURIComponent(a.id)}`}>{a.title ?? a.excerpt}</Link>
                </p>
                {a.origin && (
                  <p className="muted" style={{ margin: 0 }}>
                    De dónde vino: {a.origin.label}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}

export function HistoryDetailPage() {
  const api = useApi();
  const { id = "" } = useParams();
  const a = useAsync(() => api.analysis(id), [api, id]);
  return (
    <Page title="Análisis" lead={a.data ? `Del ${formatDateTime(a.data.at)}` : undefined}>
      <p>
        <Link to="/historial">← Volver al historial</Link>
      </p>
      {a.loading && <Spinner />}
      <ErrorAlert error={a.error} />
      {a.data && (
        <>
          {a.data.origin && <OriginCard origin={a.data.origin} />}
          <div className="card card--flat">
            <h2>Lo que analizaste</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{a.data.text}</p>
          </div>
          <AnalysisResult analysis={a.data} />
        </>
      )}
    </Page>
  );
}

/** De dónde vino lo analizado: la fuente, quién lo mandó o publicó y el link al original. */
function OriginCard({ origin }: { origin: AnalysisOrigin }) {
  return (
    <section className="card card--flat stack" aria-labelledby="de-donde-vino">
      <h2 id="de-donde-vino">De dónde vino</h2>
      <p style={{ margin: 0 }}>{origin.label}</p>
      {origin.url && (
        <p style={{ margin: 0 }}>
          <a href={origin.url} target="_blank" rel="noopener noreferrer">
            Ver el original{origin.domain ? ` en ${origin.domain}` : ""}
            <span className="visually-hidden"> (se abre en otra pestaña)</span>
          </a>
        </p>
      )}
      {(origin.kind === "feed" || origin.kind === "mailbox") && (
        <p className="muted" style={{ margin: 0 }}>
          Llegó por una fuente que conectaste. La podés ver o desconectar en <Link to="/fuentes">Mis fuentes</Link>.
        </p>
      )}
    </section>
  );
}

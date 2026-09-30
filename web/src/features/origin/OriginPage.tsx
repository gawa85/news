import { useRef, useState, type FormEvent, type Ref } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError } from "../../api/ApiError";
import { useApi } from "../../api/ApiContext";
import type { OriginTrace } from "../../api/types";
import { formatDate } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page } from "../../ui/components";
import { useAction } from "../../ui/useAsync";
import { TopicSuggestions, useOutlets, useTopics } from "../shared/catalog";

/** ¿QUIÉN LO DIJO PRIMERO?: de una nota, a la primera que lo publicó; y cuántas son casi copia. */
export function OriginPage() {
  const api = useApi();
  const { can } = useSession();
  const topics = useTopics();
  const [params] = useSearchParams();
  const [url, setUrl] = useState(() => params.get("url")?.slice(0, 2000) ?? "");
  const [topic, setTopic] = useState("");
  const [askTopic, setAskTopic] = useState(false);
  const result = useRef<HTMLElement>(null);
  const trace = useAction(async () => {
    try {
      const t = await api.traceOrigin(url.trim(), askTopic ? topic.trim() : undefined);
      setTimeout(() => result.current?.focus(), 0);
      return t;
    } catch (e) {
      // Nota que todavía no tenemos: hace falta saber de qué tema es para buscar las demás.
      if (e instanceof ApiError && e.status === 400 && /tema/.test(e.message)) setAskTopic(true);
      throw e;
    }
  });

  if (!can("origin_trace")) {
    return (
      <Page title="¿Quién lo dijo primero?" lead="De una nota, a la primera que lo publicó. Y cuántas son casi copia de la misma gacetilla.">
        <div className="card">
          <p>El rastreo del origen viene con el plan Personal o superior.</p>
          <Link className="btn" to="/planes">
            Ver planes
          </Link>
        </div>
      </Page>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && (!askTopic || topic.trim())) void trace.run();
  };

  return (
    <Page title="¿Quién lo dijo primero?" lead="Pegá el link de una nota. Buscamos quién publicó primero lo mismo y cuántas notas son casi copia: diez medios repitiendo una gacetilla no son diez fuentes.">
      <form className="card stack" onSubmit={submit} noValidate>
        <Field label="Link de la nota">
          {(p) => <input {...p} className="input" type="url" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />}
        </Field>
        {askTopic && (
          <>
            <Field label="¿De qué tema habla?" hint="Todavía no teníamos esta nota: con el tema buscamos las demás.">
              {(p) => <input {...p} className="input" list="temas-origen" required value={topic} onChange={(e) => setTopic(e.target.value)} />}
            </Field>
            <TopicSuggestions id="temas-origen" topics={topics} />
          </>
        )}
        <div className="row">
          <button className="btn" type="submit" disabled={trace.pending || !url.trim() || (askTopic && !topic.trim())}>
            {trace.pending ? "Buscando…" : "Buscar el origen"}
          </button>
        </div>
      </form>
      {!(askTopic && trace.error instanceof ApiError && trace.error.status === 400 && /tema/.test(trace.error.message)) && <ErrorAlert error={trace.error} />}
      {trace.result && <TraceView ref={result} t={trace.result} />}
    </Page>
  );
}

function TraceView({ t, ref }: { t: OriginTrace; ref: Ref<HTMLElement> }) {
  const { nameOf } = useOutlets();
  const copies = t.chain.filter((l) => l.isNearCopy).length;
  const sameAsTarget = t.origin.id === t.target.id;
  return (
    <section ref={ref} tabIndex={-1} aria-labelledby="origen-res" className="stack" aria-live="polite">
      <h2 id="origen-res">Resultado</h2>
      <div className="card stack">
        <p>
          {sameAsTarget ? (
            <>
              <strong>Esta nota es la primera</strong> que encontramos sobre esto ({nameOf(t.origin.outletId)}, {formatDate(t.origin.publishedAt)}).
            </>
          ) : (
            <>
              Lo publicó primero <strong>{nameOf(t.origin.outletId)}</strong>, el {formatDate(t.origin.publishedAt)}:{" "}
              <a href={t.origin.url} target="_blank" rel="noopener noreferrer">
                {t.origin.title}
              </a>
              .
            </>
          )}
        </p>
        <p>
          {t.chain.length} {t.chain.length === 1 ? "nota" : "notas"} sobre lo mismo · <strong>{t.independentSources}</strong>{" "}
          {t.independentSources === 1 ? "fuente independiente" : "fuentes independientes"}
          {copies > 0 && ` · ${copies} casi ${copies === 1 ? "copia" : "copias"}`}.
        </p>
        {t.likelyPressRelease && (
          <Notice title="Parece una gacetilla o un cable de agencia">
            <p>El origen es un organismo oficial o una agencia, o varias notas repiten el mismo texto. Conviene buscar quién lo contrastó.</p>
          </Notice>
        )}
        {t.echoWarning && <p className="muted">{t.echoWarning}</p>}
      </div>
      <div className="card">
        <h3>En orden de publicación</h3>
        <ol className="timeline">
          {t.chain.map((l) => (
            <li key={l.article.id} className={l.article.id === t.origin.id ? "is-origin" : undefined}>
              <p>
                <strong>{nameOf(l.article.outletId)}</strong> · {formatDate(l.article.publishedAt)}
                {l.article.id === t.origin.id && (
                  <>
                    {" "}
                    <span className="badge badge--fact">primera</span>
                  </>
                )}
                {l.isNearCopy && (
                  <>
                    {" "}
                    <span className="badge badge--smoke">casi copia</span>
                  </>
                )}
                {l.article.id === t.target.id && l.article.id !== t.origin.id && (
                  <>
                    {" "}
                    <span className="badge badge--neutral">la que pegaste</span>
                  </>
                )}
              </p>
              <p>
                <a href={l.article.url} target="_blank" rel="noopener noreferrer">
                  {l.article.title}
                </a>
              </p>
              {l.article.id !== t.origin.id && <p className="muted">Parecido con la primera: {Math.round(l.similarityToOrigin * 100)}%</p>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page } from "../../ui/components";
import { useAction } from "../../ui/useAsync";
import { AnalysisResult } from "./AnalysisResult";

const EXAMPLE = "URGENTE!!! Reenviá a todos: mañana cortan el agua en todo el país, lo dijo un funcionario. Es una catástrofe histórica sin precedentes.";

/** ANALIZAR: pegar un mensaje, una nota o un link (también de redes) y ver qué es dato y qué es humo. */
export function AnalyzePage() {
  const api = useApi();
  const { me, refresh } = useSession();
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const result = useRef<HTMLDivElement>(null);
  const analyze = useAction(async (t: string) => {
    const a = await api.analyze(t);
    void refresh(); // actualiza el uso del día
    // Al terminar, el foco va al resultado (se anuncia y se puede leer con el teclado).
    setTimeout(() => result.current?.focus(), 0);
    return a;
  });

  const limit = me?.plan.limits.analysesPerDay;
  const left = limit === null || limit === undefined ? undefined : Math.max(0, limit - (me?.usage.analyses ?? 0));
  const error = touched && !text.trim() ? "Pegá un texto o un link para analizar." : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (text.trim()) void analyze.run(text.trim());
  };

  return (
    <Page title="Analizar" lead="Pegá un mensaje, una cadena, una nota o un link (también de X, TikTok, YouTube o Telegram). Te mostramos qué es dato y qué es humo.">
      {left === 0 && (
        <Notice title="Ya usaste los análisis de hoy">
          <p>
            Mañana tenés de nuevo. Si necesitás más, <Link to="/planes">mirá los planes</Link>. Mientras tanto, podés ver tu <Link to="/historial">historial</Link>.
          </p>
        </Notice>
      )}
      <form className="card stack" onSubmit={submit} noValidate>
        <Field label="Texto o link" hint={left !== undefined ? `Te quedan ${left} análisis hoy.` : undefined} error={error}>
          {(p) => <textarea {...p} className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Pegá acá lo que te llegó…" />}
        </Field>
        <div className="row">
          <button className="btn" type="submit" disabled={analyze.pending || left === 0}>
            {analyze.pending ? "Analizando…" : "Analizar"}
          </button>
          {!text && (
            <button type="button" className="btn btn--ghost" onClick={() => setText(EXAMPLE)}>
              Probar con un ejemplo
            </button>
          )}
        </div>
      </form>
      <p className="muted">
        ¿Te llegó una foto o un video? <Link to="/revisar">Revisá si ya circuló o si lo hizo una IA</Link>.
      </p>
      <ErrorAlert error={analyze.error} />
      {analyze.result && (
        <div ref={result} tabIndex={-1} aria-live="polite">
          <AnalysisResult analysis={analyze.result} />
        </div>
      )}
    </Page>
  );
}

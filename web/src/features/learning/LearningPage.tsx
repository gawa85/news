import { useRef, useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiContext";
import type { QuizQuestion, QuizResult } from "../../api/types";
import { ErrorAlert, Field, Notice, Page } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

/**
 * MODO APRENDIZAJE: "¿esto es humo?". Se muestra un mensaje real (o parecido a uno real),
 * la persona decide y le explicamos por qué. Sirve para entrenar el ojo, no para aprobar un examen.
 */
export function LearningPage() {
  const api = useApi();
  const progress = useAsync(() => api.learningProgress(), [api]);
  const [question, setQuestion] = useState<QuizQuestion>();
  const [answer, setAnswer] = useState<QuizResult>();
  const questionBox = useRef<HTMLDivElement>(null);
  const answerBox = useRef<HTMLDivElement>(null);

  const next = useAction(async () => {
    const q = await api.learningNext();
    setQuestion(q);
    setAnswer(undefined);
    setTimeout(() => questionBox.current?.focus(), 0);
    return q;
  });
  const reply = useAction(async (isSmoke: boolean) => {
    const r = await api.learningAnswer(isSmoke);
    setAnswer(r);
    progress.setData({ answered: r.score.answered, correct: r.score.correct, level: r.score.level, bestStreak: Math.max(progress.data?.bestStreak ?? 0, r.streak) });
    setTimeout(() => answerBox.current?.focus(), 0);
    return r;
  });

  const p = progress.data;
  return (
    <Page title="¿Esto es humo?" lead="Te mostramos un mensaje. Vos decidís si es humo o si es un dato limpio, y te explicamos por qué. Es un juego: no hay nota, sólo práctica.">
      {p && p.answered > 0 && (
        <section className="card" aria-labelledby="progreso">
          <h2 id="progreso" className="visually-hidden">
            Tu progreso
          </h2>
          <dl className="stats">
            <div>
              <dt>Nivel</dt>
              <dd>{p.level}</dd>
            </div>
            <div>
              <dt>Aciertos</dt>
              <dd>
                {p.correct} de {p.answered}
              </dd>
            </div>
            <div>
              <dt>Mejor racha</dt>
              <dd>{p.bestStreak}</dd>
            </div>
          </dl>
        </section>
      )}

      {!question && (
        <div className="card stack">
          <p>Son mensajes como los que llegan por WhatsApp o aparecen en las redes. Algunos traen datos con fuente; otros, mucho humo.</p>
          <div className="row">
            <button className="btn" type="button" onClick={() => void next.run()} disabled={next.pending}>
              {next.pending ? "Cargando…" : p && p.answered > 0 ? "Seguir jugando" : "Empezar"}
            </button>
          </div>
        </div>
      )}
      <ErrorAlert error={next.error} />

      {question && (
        <section className="card stack" aria-labelledby="pregunta">
          <div ref={questionBox} tabIndex={-1} className="stack">
            <h2 id="pregunta">¿Esto es humo?</h2>
            <blockquote className="quiz__text">{question.text}</blockquote>
          </div>
          {!answer && (
            <div className="row quiz__answers" role="group" aria-label="Tu respuesta">
              <button className="btn" type="button" onClick={() => void reply.run(true)} disabled={reply.pending}>
                Es humo
              </button>
              <button className="btn btn--secondary" type="button" onClick={() => void reply.run(false)} disabled={reply.pending}>
                Es un dato limpio
              </button>
            </div>
          )}
          <ErrorAlert error={reply.error} />
          {answer && (
            <div ref={answerBox} tabIndex={-1} className="stack">
              <div className={`alert ${answer.correct ? "alert--ok" : "alert--error"}`} role="status">
                <p className="alert__title">{answer.correct ? "¡Bien!" : "Esta vez no"}</p>
                <p>
                  {answer.wasSmoke ? "Era humo." : "Era un dato limpio."} {answer.explanation}
                </p>
                {answer.streak > 1 && <p>Llevás {answer.streak} seguidas.</p>}
              </div>
              <div className="row">
                <button className="btn" type="button" onClick={() => void next.run()} disabled={next.pending}>
                  {next.pending ? "Cargando…" : "Otra"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <JoinClassroom />
    </Page>
  );
}

/** Para estudiantes: sumarse al aula del docente con un código y un apodo (sin datos personales). */
function JoinClassroom() {
  const api = useApi();
  const [code, setCode] = useState("");
  const [alias, setAlias] = useState("");
  const join = useAction(async () => {
    await api.joinClassroom(code.trim().toUpperCase(), alias.trim());
    return true;
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim() && alias.trim()) void join.run();
  };
  return (
    <details className="card">
      <summary>¿Tu docente te dio un código de aula?</summary>
      <form className="stack" onSubmit={submit} noValidate style={{ marginTop: "var(--space-4)" }}>
        <div className="grid-2">
          <Field label="Código del aula">{(p) => <input {...p} className="input mono" autoComplete="off" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <Field label="Tu apodo" hint="Sin tu nombre real, mail ni teléfono: es lo que ve tu docente.">
            {(p) => <input {...p} className="input" autoComplete="off" maxLength={20} value={alias} onChange={(e) => setAlias(e.target.value)} />}
          </Field>
        </div>
        <div className="row">
          <button className="btn btn--secondary" type="submit" disabled={join.pending || !code.trim() || !alias.trim()}>
            {join.pending ? "Sumándote…" : "Sumarme al aula"}
          </button>
        </div>
        <ErrorAlert error={join.error} />
        {join.result && (
          <Notice tone="ok">
            <p>Listo: tus respuestas cuentan para el aula.</p>
          </Notice>
        )}
      </form>
    </details>
  );
}

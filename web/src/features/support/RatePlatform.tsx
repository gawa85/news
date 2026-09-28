import { useEffect, useState, type FormEvent } from "react";
import { useApi } from "../../api/ApiContext";
import type { ReviewTarget } from "../../api/types";
import { ErrorAlert, Field, Notice } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const PLATFORM: ReviewTarget = { type: "platform", id: "sinhumo" };
const WORDS = ["", "Muy mal", "Mal", "Regular", "Bien", "Muy bien"];

/**
 * CALIFICAR SIN HUMO: de 1 a 5 y un comentario opcional. Volver a calificar la edita.
 * Las estrellas son botones de radio (se usan con teclado y se leen con el lector de pantalla).
 */
export function RatePlatform() {
  const api = useApi();
  const mine = useAsync(() => api.myReview(PLATFORM), [api]);
  const summary = useAsync(() => api.reviewSummary(PLATFORM), [api]);
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    if (mine.data) {
      setRating(mine.data.rating);
      setText(mine.data.text ?? "");
    }
  }, [mine.data]);
  const send = useAction(async () => {
    const r = await api.review(PLATFORM, rating, text.trim() || undefined);
    void summary.reload();
    return r;
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (rating !== null || text.trim()) void send.run();
  };
  const s = summary.data;
  return (
    <section className="card stack" aria-labelledby="calificar">
      <h2 id="calificar">¿Qué te parece Sin Humo?</h2>
      {s && s.count > 0 && (
        <p className="muted">
          Promedio: {s.average?.toLocaleString("es-AR")} de 5 ({s.count} {s.count === 1 ? "calificación" : "calificaciones"}).
        </p>
      )}
      <form className="stack" onSubmit={submit} noValidate>
        <fieldset>
          <legend className="field__label">Tu calificación</legend>
          <div className="row">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="row" style={{ gap: "var(--space-1)" }}>
                <input type="radio" name="calificacion" value={n} checked={rating === n} onChange={() => setRating(n)} />
                <span aria-hidden="true">{"★".repeat(n)}</span>
                <span className="visually-hidden">
                  {n} de 5: {WORDS[n]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Comentario (opcional)" hint="Contanos qué te sirvió o qué mejorarías. Lo lee el equipo.">
          {(p) => <textarea {...p} className="textarea" style={{ minHeight: "4.5rem" }} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="row">
          <button className="btn btn--secondary" type="submit" disabled={send.pending || (rating === null && !text.trim())}>
            {send.pending ? "Enviando…" : mine.data ? "Actualizar mi calificación" : "Enviar calificación"}
          </button>
        </div>
        <ErrorAlert error={send.error} />
        {send.result && (
          <Notice tone="ok">
            <p>{send.result.status === "pending_moderation" ? "¡Gracias! Tu comentario queda en revisión antes de publicarse." : send.result.status === "rejected" ? "Guardamos tu calificación; el comentario no pasó la moderación." : "¡Gracias por calificar!"}</p>
          </Notice>
        )}
      </form>
    </section>
  );
}

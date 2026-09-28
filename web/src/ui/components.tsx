import { useEffect, useId, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError, messageOf } from "../api/ApiError";
import { smokeVerdict } from "../domain/labels";

/**
 * Página: pone el título de la pestaña y, al llegar, lleva el foco al título (así un lector
 * de pantalla anuncia en qué pantalla está la persona después de navegar).
 */
export function Page({ title, lead, narrow, children }: { title: string; lead?: ReactNode; narrow?: boolean; children: ReactNode }) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · Sin Humo`;
    h1.current?.focus();
  }, [title]);
  return (
    <div className={`page${narrow ? " page--narrow" : ""}`}>
      <h1 ref={h1} tabIndex={-1}>
        {title}
      </h1>
      {lead && <p className="page__lead">{lead}</p>}
      <div className="stack">{children}</div>
    </div>
  );
}

/** Campo de formulario con etiqueta visible, ayuda y error asociados (aria-describedby). */
export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-ayuda` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {hint && (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true } : {}) })}
      {error && (
        <span className="field__error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}

export function Spinner({ label = "Cargando…" }: { label?: string }) {
  return (
    <span className="row muted" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Error explicado para una persona: qué pasó y qué hacer (mejorar el plan, esperar, entrar).
 * Se anuncia a los lectores de pantalla (role="alert").
 */
export function ErrorAlert({ error, title = "No se pudo completar" }: { error: unknown; title?: string }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : undefined;
  const wait = e?.retryAfterSeconds ? (e.retryAfterSeconds < 120 ? `${e.retryAfterSeconds} segundos` : `${Math.ceil(e.retryAfterSeconds / 60)} minutos`) : undefined;
  return (
    <div className="alert alert--error" role="alert">
      <p className="alert__title">{title}</p>
      <p>{messageOf(error)}</p>
      {wait && <p>Podés volver a intentar en {wait}.</p>}
      {e?.upgradeHint && (
        <p>
          {e.upgradeHint} <Link to="/planes">Ver planes</Link>
        </p>
      )}
      {e?.needsLogin && (
        <p>
          <Link to="/entrar">Entrá a tu cuenta</Link> para seguir.
        </p>
      )}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "ok"; title?: string; children: ReactNode }) {
  return (
    <div className={`alert alert--${tone}`} role="status">
      {title && <p className="alert__title">{title}</p>}
      {children}
    </div>
  );
}

/** Índice de humo: número, barra y veredicto en palabras (nunca sólo el color). */
export function SmokeMeter({ index }: { index: number }) {
  const v = smokeVerdict(index);
  return (
    <div className="meter">
      <div className="row">
        <span className="meter__value">{index}</span>
        <span>
          <span className="visually-hidden">Índice de humo: {index} sobre 100. </span>
          <span className={`badge badge--${v.tone}`}>{v.label}</span>
        </span>
      </div>
      <div className="meter__bar" role="img" aria-label={`${index} de 100 de humo`}>
        <div className={`meter__fill${v.tone === "fact" ? "" : " meter__fill--smoke"}`} style={{ width: `${Math.max(2, index)}%` }} />
      </div>
      <p className="muted">0 = sólo datos · 100 = todo humo</p>
    </div>
  );
}

/** Puntaje de 0 a 1 como barra con texto. */
export function ScoreBar({ score, label }: { score: number | null; label: string }) {
  const pct = score === null ? 0 : Math.round(score * 100);
  return (
    <div className="meter">
      <div className="row">
        <strong>{label}</strong>
        <span className="muted">{score === null ? "sin datos" : `${pct}/100`}</span>
      </div>
      <div className="meter__bar" role="img" aria-label={`${label}: ${score === null ? "sin datos" : `${pct} de 100`}`}>
        <div className="meter__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

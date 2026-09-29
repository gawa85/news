import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useSession } from "../session/SessionContext";
import { ErrorAlert, Spinner } from "../ui/components";

/** Pantallas que piden sesión: sin sesión, a "Entrar" (y después, de vuelta acá). */
export function RequireSession({ children }: { children: ReactNode }) {
  const { me, problem, refresh } = useSession();
  const where = useLocation();
  if (me === null && problem)
    return (
      <div className="page stack">
        <ErrorAlert error={problem} title="No pudimos conectarnos con Sin Humo" />
        <p>Tu sesión sigue abierta. Probá de nuevo en un momento.</p>
        <div className="row">
          <button className="btn" type="button" onClick={() => void refresh()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  if (me === null)
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  if (!me) return <Navigate to={`/entrar?next=${encodeURIComponent(where.pathname + where.search)}`} replace />;
  return <>{children}</>;
}

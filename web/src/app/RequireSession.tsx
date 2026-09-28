import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useSession } from "../session/SessionContext";
import { Spinner } from "../ui/components";

/** Pantallas que piden sesión: sin sesión, a "Entrar" (y después, de vuelta acá). */
export function RequireSession({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const where = useLocation();
  if (me === null)
    return (
      <div className="page">
        <Spinner />
      </div>
    );
  if (!me) return <Navigate to={`/entrar?next=${encodeURIComponent(where.pathname + where.search)}`} replace />;
  return <>{children}</>;
}

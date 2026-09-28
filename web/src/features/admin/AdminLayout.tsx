import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useSession } from "../../session/SessionContext";
import { Page } from "../../ui/components";
import { ADMIN_SECTIONS } from "./sections";

/**
 * BACKOFFICE: una sola web; cada persona ve las secciones de sus permisos.
 * (La web sólo decide qué mostrar: el servidor controla cada acción.)
 */
export function AdminLayout() {
  const { has } = useSession();
  const where = useLocation();
  const mine = ADMIN_SECTIONS.filter((s) => has(s.permission));
  if (!mine.length) {
    return (
      <Page title="Backoffice">
        <p>Tu cuenta no tiene tareas de administración.</p>
      </Page>
    );
  }
  if (where.pathname === "/admin" || where.pathname === "/admin/") return <Navigate to={`/admin/${mine[0]!.path}`} replace />;
  return (
    <div className="admin">
      <nav className="admin__nav" aria-label="Backoffice">
        <ul>
          {mine.map((s) => (
            <li key={s.path}>
              <NavLink to={`/admin/${s.path}`}>{s.label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="admin__main">
        <Outlet />
      </div>
    </div>
  );
}

/** ¿Tiene alguna sección del backoffice? (para mostrar el acceso en el menú) */
export function useHasBackoffice(): boolean {
  const { has } = useSession();
  return ADMIN_SECTIONS.some((s) => has(s.permission));
}

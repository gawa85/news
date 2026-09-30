import { NavLink } from "react-router";

/** Las dos vistas de Credibilidad: todos los medios juntos o un medio en detalle. */
export function CredibilityTabs() {
  return (
    <nav className="tabs" aria-label="Vistas de credibilidad">
      <NavLink to="/credibilidad/panorama" end>
        Todos los medios
      </NavLink>
      <NavLink to="/credibilidad" end>
        Un medio
      </NavLink>
    </nav>
  );
}

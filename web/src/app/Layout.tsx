import { NavLink, Outlet, Link } from "react-router";
import { useSession } from "../session/SessionContext";
import { LegalBanner } from "../features/account/LegalBanner";

function Logo() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path d="M9 20c0-3 2-4 4-4s3-2 3-4 2-4 5-4" fill="none" stroke="var(--brand-text)" strokeWidth="2.5" strokeLinecap="round" opacity=".45" />
      <path d="M8 24h16" stroke="var(--brand-text)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Estructura común: saltar al contenido, encabezado con navegación, contenido y pie. */
export function Layout() {
  const { me } = useSession();
  return (
    <>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="brand" aria-label="Sin Humo, inicio">
            <Logo />
            <span>Sin Humo</span>
          </Link>
          <nav className="nav" aria-label="Principal">
            {me ? (
              <>
                <NavLink to="/analizar">Analizar</NavLink>
                <NavLink to="/comparar">Comparar fuentes</NavLink>
                <NavLink to="/credibilidad">Credibilidad</NavLink>
                <NavLink to="/historial">Historial</NavLink>
                <NavLink to="/eventos">Eventos</NavLink>
                <NavLink to="/cuenta">Mi cuenta</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/eventos">Eventos en vivo</NavLink>
                <NavLink to="/planes">Planes</NavLink>
                <NavLink to="/entrar">Entrar</NavLink>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="contenido">
        {me && <LegalBanner />}
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span>Sin Humo · Hechos, no humo.</span>
          <nav aria-label="Secundaria" className="row">
            <span>También por WhatsApp, Telegram y mail.</span>
            {me && <Link to="/archivo">Archivo de notas</Link>}
            {me && <Link to="/ayuda">Ayuda</Link>}
            <Link to="/planes">Planes</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}

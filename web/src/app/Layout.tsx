import { NavLink, Outlet, Link, useLocation } from "react-router";
import { PageHelp } from "../features/help/PageHelp";
import { helpFor } from "../features/help/helpContent";
import { PageHelpSlot } from "../ui/pageHelpSlot";
import { useSession } from "../session/SessionContext";
import { LegalBanner } from "../features/account/LegalBanner";
import { OnboardingBanner } from "../features/onboarding/OnboardingBanner";
import { useHasBackoffice } from "../features/admin/AdminLayout";

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
  const { me, can } = useSession();
  const backoffice = useHasBackoffice();
  const where = useLocation();
  const help = helpFor(where.pathname);
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
                <NavLink to="/origen">¿Quién lo dijo?</NavLink>
                {/* Entra por todos los medios juntos; sigue marcada en la vista de un medio. */}
                <Link to="/credibilidad/panorama" aria-current={where.pathname.startsWith("/credibilidad") ? "page" : undefined}>
                  Credibilidad
                </Link>
                <NavLink to="/historial">Historial</NavLink>
                {can("team_rooms") && <NavLink to="/salas">Salas</NavLink>}
                <NavLink to="/eventos">Eventos</NavLink>
                {backoffice && <NavLink to="/admin">Backoffice</NavLink>}
                <NavLink to="/cuenta">Mi cuenta</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/observatorio">Observatorio</NavLink>
                <NavLink to="/medios">Medios</NavLink>
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
        {me && <OnboardingBanner />}
        <PageHelpSlot.Provider value={help ? <PageHelp help={help} /> : null}>
          <Outlet />
        </PageHelpSlot.Provider>
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span>Sin Humo · Hechos, no humo.</span>
          <nav aria-label="Secundaria" className="row">
            <span>También por WhatsApp, Telegram y mail.</span>
            {me && <Link to="/alertas">Alertas</Link>}
            {me && <Link to="/jugar">¿Esto es humo? (juego)</Link>}
            {me && <Link to="/archivo">Archivo de notas</Link>}
            {me && <Link to="/ayuda">Ayuda</Link>}
            <Link to="/observatorio">Observatorio</Link>
            <Link to="/medios">Medios</Link>
            <Link to="/fe-de-erratas">Fe de erratas</Link>
            <Link to="/datos">Datos abiertos</Link>
            <Link to="/planes">Planes</Link>
            <Link to="/glosario">Glosario</Link>
            <Link to="/legal/terminos">Términos</Link>
            <Link to="/legal/privacidad">Privacidad</Link>
          </nav>
        </div>
      </footer>
    </>
  );
}

import { Link, useLocation } from "react-router";
import { useApi } from "../../api/ApiContext";
import { useAction, useAsync } from "../../ui/useAsync";

/** "Configurá tu cuenta": aviso discreto mientras falten pasos de la bienvenida (se puede cerrar para siempre). */
export function OnboardingBanner() {
  const api = useApi();
  const where = useLocation();
  const status = useAsync(() => api.onboarding().catch(() => undefined), [api]);
  const dismiss = useAction(async () => status.setData(await api.dismissOnboarding()));
  const s = status.data;
  if (!s || s.dismissed || s.pending === 0 || where.pathname === "/bienvenida" || where.pathname.startsWith("/admin")) return null;
  const done = s.steps.filter((x) => x.done).length;
  return (
    <div className="page" style={{ paddingBlock: "var(--space-4) 0" }}>
      <div className="alert alert--info" role="region" aria-label="Configurá tu cuenta">
        <p className="alert__title">Configurá tu cuenta</p>
        <p>
          Llevás {done} de {s.steps.length} pasos: temas que te interesan, WhatsApp o Telegram, avisos y tu primer análisis.
        </p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Link className="btn btn--small" to="/bienvenida">
            Seguir con la bienvenida
          </Link>
          <button type="button" className="btn btn--ghost btn--small" disabled={dismiss.pending} onClick={() => void dismiss.run()}>
            No mostrar más
          </button>
        </div>
      </div>
    </div>
  );
}

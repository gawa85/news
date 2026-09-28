import { useApi } from "../../api/ApiContext";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert } from "../../ui/components";
import { useAction } from "../../ui/useAsync";

/** Términos o privacidad nuevos por aceptar (queda registrado qué versión y cuándo). */
export function LegalBanner() {
  const api = useApi();
  const { me, refresh } = useSession();
  const accept = useAction(async () => {
    for (const d of me?.pendingLegal ?? []) await api.acceptLegal(d.id, d.version);
    await refresh();
    return true;
  });
  const pending = me?.pendingLegal ?? [];
  if (pending.length === 0) return null;
  return (
    <div className="page" style={{ paddingBlock: "var(--space-4) 0" }}>
      <div className="alert alert--info" role="region" aria-label="Documentos por aceptar">
        <p className="alert__title">Actualizamos {pending.length === 1 ? "un documento" : "nuestros documentos"}</p>
        <ul>
          {pending.map((d) => (
            <li key={d.id}>
              <a href={d.url} target="_blank" rel="noopener noreferrer">
                {d.title}
              </a>
              {d.summary && <span className="muted"> — {d.summary}</span>}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn--small" onClick={() => void accept.run()} disabled={accept.pending}>
          Leí y acepto
        </button>
        <ErrorAlert error={accept.error} />
      </div>
    </div>
  );
}

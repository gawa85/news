import { useApi } from "../../api/ApiContext";
import { formatDateTime } from "../../domain/labels";
import { ErrorAlert } from "../../ui/components";
import { useAction } from "../../ui/useAsync";

/**
 * VINCULAR WHATSAPP O TELEGRAM: la web da un código y la persona lo manda desde el chat (el botón
 * abre el chat con el mensaje ya escrito). Así se prueba que el número o la cuenta es suya.
 */
export function ChannelLinker({ onChecked }: { onChecked?: () => void }) {
  const api = useApi();
  const code = useAction(() => api.channelLinkCode());
  const c = code.result;
  return (
    <div className="stack">
      {!c && (
        <div className="row">
          <button className="btn btn--small" type="button" disabled={code.pending} onClick={() => void code.run()}>
            Pedir un código para vincular
          </button>
        </div>
      )}
      <ErrorAlert error={code.error} title="No se pudo pedir el código" />
      {c && (
        <div className="card card--flat stack">
          <p style={{ margin: 0 }}>
            Mandá este mensaje desde el WhatsApp o el Telegram que querés usar:
          </p>
          <p className="mono" style={{ fontSize: "1.4rem", margin: 0 }}>
            VINCULAR {c.code}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Vence el {formatDateTime(c.expiresAt)}. Sirve una sola vez.
          </p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {c.whatsappUrl && (
              <a className="btn btn--small" href={c.whatsappUrl} target="_blank" rel="noopener noreferrer">
                Abrir WhatsApp
              </a>
            )}
            {c.telegramUrl && (
              <a className="btn btn--small" href={c.telegramUrl} target="_blank" rel="noopener noreferrer">
                Abrir Telegram
              </a>
            )}
            {onChecked && (
              <button className="btn btn--ghost btn--small" type="button" onClick={onChecked}>
                Ya lo mandé
              </button>
            )}
          </div>
          {!c.whatsappUrl && !c.telegramUrl && <p className="muted">Escribile el mensaje al número o al bot de Sin Humo.</p>}
        </div>
      )}
    </div>
  );
}

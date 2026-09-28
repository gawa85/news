import { useCallback, useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";
import { useApi } from "../../api/ApiContext";
import { ApiError } from "../../api/ApiError";
import { useSession } from "../../session/SessionContext";
import { Captcha } from "../../ui/Captcha";
import { ErrorAlert, Field, Notice, Page } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const RETURN_ERRORS: Record<string, string> = {
  enlace: "El enlace para entrar venció o ya se usó. Pedí uno nuevo.",
  google: "No pudimos entrar con Google. Probá de nuevo o entrá con tu mail.",
};

/** Sólo rutas de este sitio (nunca a otro dominio después de entrar). */
const safeNext = (next: string | null) => (next && /^\/(?![/\\])/.test(next) ? next : "/analizar");

/**
 * ENTRAR: con un enlace al mail (lo principal: no pide recordar nada, WCAG 3.3.8), con
 * Google si está configurado, o con contraseña. El captcha aparece cuando hace falta.
 */
export function LoginPage() {
  const api = useApi();
  const { me, refresh } = useSession();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const options = useAsync(() => api.authOptions(), [api]);
  const [mode, setMode] = useState<"link" | "password">("link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string>();
  const onToken = useCallback((t: string | undefined) => setCaptchaToken(t), []);

  const sendLink = useAction(async () => {
    await api.requestMagicLink(email.trim(), captchaToken);
    return true;
  });
  const login = useAction(async () => {
    await api.loginWithPassword(email.trim(), password, captchaToken);
    await refresh();
    return true;
  });
  const failure = sendLink.error ?? login.error;
  // Con captcha configurado se muestra siempre (las altas lo piden; Turnstile casi nunca molesta).
  // Si igual el servidor lo pide (mucha actividad), llega en el error.
  const captcha = options.data?.captcha ?? (failure instanceof ApiError ? failure.captcha : undefined);

  if (me) return <Navigate to={next} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void (mode === "link" ? sendLink.run() : login.run());
  };

  const returnError = RETURN_ERRORS[params.get("error") ?? ""];
  const google = options.data?.providers.includes("google");

  return (
    <Page title="Entrar a Sin Humo" lead="Te mandamos un enlace a tu mail: sin contraseñas que recordar. Si no tenés cuenta, se crea sola." narrow>
      {returnError && <ErrorAlert error={new ApiError(400, returnError)} title="No pudiste entrar" />}

      {sendLink.result ? (
        <Notice tone="ok" title="Revisá tu mail">
          <p>
            Si <strong>{email}</strong> es válido, te llegó un enlace para entrar. Vence en 15 minutos y sirve una sola vez.
          </p>
          <p>¿No llegó? Mirá en correo no deseado o <button type="button" className="btn btn--ghost btn--small" onClick={sendLink.reset}>pedí otro</button>.</p>
        </Notice>
      ) : (
        <div className="card">
          <div className="tabs" role="tablist" aria-label="Cómo querés entrar">
            <button type="button" role="tab" id="tab-link" aria-selected={mode === "link"} aria-controls="panel-login" onClick={() => setMode("link")}>
              Con enlace al mail
            </button>
            <button type="button" role="tab" id="tab-password" aria-selected={mode === "password"} aria-controls="panel-login" onClick={() => setMode("password")}>
              Con contraseña
            </button>
          </div>
          <form id="panel-login" role="tabpanel" aria-labelledby={mode === "link" ? "tab-link" : "tab-password"} className="stack" onSubmit={submit} noValidate>
            <Field label="Tu mail">
              {(p) => <input {...p} className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
            {mode === "password" && (
              <Field label="Contraseña" hint="Si todavía no tenés una, entrá con el enlace y creala desde tu cuenta.">
                {(p) => <input {...p} className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
            )}
            {captcha && <Captcha provider={captcha.provider} siteKey={captcha.siteKey} onToken={onToken} />}
            <ErrorAlert error={failure instanceof ApiError && failure.needsCaptcha && !captchaToken ? undefined : failure} />
            <div className="row">
              <button className="btn" type="submit" disabled={sendLink.pending || login.pending || !email.trim() || (!!captcha && !captchaToken)}>
                {mode === "link" ? (sendLink.pending ? "Enviando…" : "Mandame el enlace") : login.pending ? "Entrando…" : "Entrar"}
              </button>
            </div>
          </form>
          {google && (
            <div className="stack" style={{ marginTop: "var(--space-5)" }}>
              <p className="muted">O también:</p>
              <a className="btn btn--secondary" href={`/auth/google?next=${encodeURIComponent(next)}`}>
                Entrar con Google
              </a>
            </div>
          )}
        </div>
      )}
      <p className="muted">
        Al entrar aceptás los términos y la política de privacidad. Tus datos no se venden y podés borrarlos cuando quieras.
      </p>
    </Page>
  );
}

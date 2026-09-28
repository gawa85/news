import { useEffect, useRef } from "react";

/**
 * Captcha (Cloudflare Turnstile o hCaptcha). Carga el script del proveedor sólo cuando hace
 * falta y avisa el token. Turnstile casi nunca pide resolver nada (no es una prueba cognitiva:
 * WCAG 3.3.8), y ambos tienen alternativa accesible.
 */
const SCRIPTS: Record<string, { src: string; global: string }> = {
  turnstile: { src: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", global: "turnstile" },
  hcaptcha: { src: "https://js.hcaptcha.com/1/api.js?render=explicit&hl=es", global: "hcaptcha" },
};

interface Widget {
  render(el: HTMLElement, opts: Record<string, unknown>): string | number;
  remove?(id: string | number): void;
}

function load(provider: string): Promise<Widget> {
  const s = SCRIPTS[provider];
  if (!s) return Promise.reject(new Error(`Captcha desconocido: ${provider}`));
  const w = window as unknown as Record<string, Widget | undefined>;
  if (w[s.global]) return Promise.resolve(w[s.global]!);
  return new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = s.src;
    tag.async = true;
    tag.onload = () => (w[s.global] ? resolve(w[s.global]!) : reject(new Error("El captcha no cargó.")));
    tag.onerror = () => reject(new Error("El captcha no cargó."));
    document.head.appendChild(tag);
  });
}

export function Captcha({ provider, siteKey, onToken }: { provider: string; siteKey: string; onToken: (token: string | undefined) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | number | undefined;
    let widget: Widget | undefined;
    let cancelled = false;
    load(provider)
      .then((w) => {
        if (cancelled || !box.current) return;
        widget = w;
        id = w.render(box.current, {
          sitekey: siteKey,
          language: "es",
          callback: (t: string) => onToken(t),
          "expired-callback": () => onToken(undefined),
          "error-callback": () => onToken(undefined),
        });
      })
      .catch(() => onToken(undefined));
    return () => {
      cancelled = true;
      if (widget?.remove && id !== undefined) widget.remove(id);
    };
  }, [provider, siteKey, onToken]);
  return (
    <div className="field">
      <span className="field__label">Verificación</span>
      <span className="field__hint">Confirmá que sos una persona.</span>
      <div ref={box} />
    </div>
  );
}

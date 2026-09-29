import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import { useBackoffice } from "../../api/BackofficeContext";
import type { NewCoupon } from "../../api/backofficeTypes";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

// ---------------------------------------------------------------- Referidos (en Mi cuenta)

/** INVITÁ Y GANÁ: tu código (un mes gratis cuando alguien que invitaste se suscribe) y cargar el de quien te invitó. */
export function ReferralsSection() {
  const api = useApi();
  const summary = useAsync(() => api.referrals(), [api]);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const apply = useAction(() => api.applyReferral(code.trim().toUpperCase()));
  const s = summary.data;
  return (
    <section className="card stack" aria-labelledby="invita">
      <h2 id="invita">Invitá y ganá</h2>
      {summary.loading && <Spinner />}
      {s && (
        <>
          <p>
            Tu código: <strong className="mono" style={{ fontSize: "1.2rem" }}>{s.code}</strong>{" "}
            <button
              className="btn btn--ghost btn--small"
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(`Probá Sin Humo para sacarle el humo a lo que te llega. Con mi código ${s.code} tenés un descuento de bienvenida.`)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {copied ? "Copiado" : "Copiar invitación"}
            </button>
          </p>
          <p className="muted" role="status">
            Por cada persona que invitás y se suscribe, ganás un mes gratis. Invitaste a {s.invited}; {s.rewarded} ya te dieron premio{s.pending ? ` y ${s.pending} todavía no se suscribió` : ""}.
          </p>
        </>
      )}
      <form
        className="row"
        style={{ alignItems: "end" }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (code.trim()) void apply.run();
        }}
      >
        <Field label="¿Te invitó alguien? Su código">{(p) => <input {...p} className="input mono" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
        <button className="btn btn--secondary" type="submit" disabled={apply.pending || !code.trim()}>
          Usar código
        </button>
      </form>
      <ErrorAlert error={apply.error} />
      {apply.result && (
        <Notice tone="ok">
          <p>
            Listo: tenés {apply.result.percent} % de descuento con el cupón <strong className="mono">{apply.result.welcomeCoupon}</strong>. Usalo al <Link to="/planes">elegir un plan</Link>.
          </p>
        </Notice>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Marca blanca

/** Contraste WCAG de un color con texto blanco (el mismo cálculo que hace el servidor). */
function contrastWithWhite(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  return 1.05 / (l + 0.05);
}

/**
 * MARCA BLANCA: tu nombre, logo y color en las respuestas y mails, y un dominio propio.
 * El color tiene que tener contraste accesible con texto blanco (4,5:1).
 */
export function BrandingPage() {
  const api = useApi();
  const { has, can } = useSession();
  const allowed = has("users:manage_org") && can("white_label");
  const current = useAsync(() => (allowed ? api.branding() : Promise.resolve(null)), [api, allowed]);
  const [form, setForm] = useState({ displayName: "", logoUrl: "", primaryColor: "#0f766e", footer: "", emailFromName: "", hidePoweredBy: false });
  const [domain, setDomain] = useState("");
  useEffect(() => {
    const b = current.data;
    if (b) {
      setForm({ displayName: b.displayName, logoUrl: b.logoUrl ?? "", primaryColor: b.primaryColor ?? "#0f766e", footer: b.footer ?? "", emailFromName: b.emailFromName ?? "", hidePoweredBy: b.hidePoweredBy });
      setDomain(b.customDomain ?? "");
    }
  }, [current.data]);
  const save = useAction(async () => {
    await api.updateBranding({ ...form, logoUrl: form.logoUrl.trim() || null, footer: form.footer.trim() || null, emailFromName: form.emailFromName.trim() || null });
    await current.reload();
    return true;
  });
  const setDom = useAction(async () => {
    await api.setBrandingDomain(domain.trim());
    await current.reload();
  });
  const verify = useAction(async () => {
    await api.verifyBrandingDomain();
    await current.reload();
    return true;
  });

  if (!allowed) {
    return (
      <Page title="Marca propia" lead="Tu nombre, logo y color en las respuestas, los mails y un dominio propio.">
        <div className="card">
          <p>
            La marca blanca es para quien administra una organización con el plan Empresa. <Link to="/planes">Ver planes</Link>
          </p>
        </div>
      </Page>
    );
  }
  const ratio = /^#[0-9a-f]{6}$/i.test(form.primaryColor) ? contrastWithWhite(form.primaryColor) : 0;
  const b = current.data;
  return (
    <Page title="Marca propia" lead="Así ven las respuestas y los mails las personas de tu organización y tu público.">
      {current.loading && !b && <Spinner />}
      <form
        className="card stack"
        noValidate
        aria-labelledby="identidad"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.displayName.trim() && ratio >= 4.5) void save.run();
        }}
      >
        <h2 id="identidad">Identidad</h2>
        <div className="grid-2">
          <Field label="Nombre que se muestra">{(p) => <input {...p} className="input" maxLength={60} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />}</Field>
          <Field label="Nombre del remitente de los mails">{(p) => <input {...p} className="input" maxLength={60} value={form.emailFromName} onChange={(e) => setForm({ ...form, emailFromName: e.target.value })} />}</Field>
          <Field label="Logo (link https a una imagen)" hint="png, svg, jpg o webp.">
            {(p) => <input {...p} className="input" type="url" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} />}
          </Field>
          <Field
            label="Color principal"
            hint={ratio >= 4.5 ? `Contraste con texto blanco: ${ratio.toFixed(1)}:1 (bien).` : `Contraste con texto blanco: ${ratio.toFixed(1)}:1 — hace falta al menos 4,5:1 para que se lea.`}
            error={ratio < 4.5 ? "Elegí un color más oscuro." : undefined}
          >
            {(p) => (
              <div className="row">
                <input {...p} className="input mono" style={{ maxWidth: "9rem" }} value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
                <input type="color" aria-label="Elegir el color principal" value={/^#[0-9a-f]{6}$/i.test(form.primaryColor) ? form.primaryColor : "#000000"} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} />
              </div>
            )}
          </Field>
        </div>
        <Field label="Pie de los mensajes">{(p) => <input {...p} className="input" maxLength={200} value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} />}</Field>
        <label className="row">
          <input type="checkbox" checked={form.hidePoweredBy} onChange={(e) => setForm({ ...form, hidePoweredBy: e.target.checked })} /> Ocultar «con tecnología de Sin Humo»
        </label>
        <div className="card card--flat" aria-label="Vista previa">
          <p className="muted" style={{ margin: 0 }}>
            Vista previa:
          </p>
          <p style={{ margin: "var(--space-2) 0 0" }}>
            <span style={{ background: ratio >= 4.5 ? form.primaryColor : "#555", color: "#fff", padding: "4px 10px", borderRadius: 6, fontWeight: 600 }}>{form.displayName || "Tu organización"}</span>{" "}
            {form.footer && <span className="muted">{form.footer}</span>}
          </p>
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={save.pending || !form.displayName.trim() || ratio < 4.5}>
            Guardar
          </button>
        </div>
        <ErrorAlert error={save.error} />
        {save.result && !save.pending && (
          <Notice tone="ok">
            <p>Guardado.</p>
          </Notice>
        )}
      </form>

      <section className="card stack" aria-labelledby="dominio">
        <h2 id="dominio">Dominio propio</h2>
        {!b ? (
          <p className="muted">Primero guardá el nombre y la marca.</p>
        ) : b.domainVerifiedAt ? (
          <p>
            <span className="badge badge--fact">Verificado</span> <span className="mono">{b.customDomain}</span>
          </p>
        ) : (
          <>
            <form
              className="row"
              style={{ alignItems: "end" }}
              onSubmit={(e) => {
                e.preventDefault();
                if (domain.trim()) void setDom.run();
              }}
            >
              <Field label="Dominio" hint="Por ejemplo: chequeo.tudiario.com">{(p) => <input {...p} className="input mono" value={domain} onChange={(e) => setDomain(e.target.value)} />}</Field>
              <button className="btn btn--secondary" type="submit" disabled={setDom.pending || !domain.trim()}>
                Usar este dominio
              </button>
            </form>
            {b.txt && (
              <div className="stack">
                <p>Cargá este registro en el DNS de tu dominio y después tocá «Verificar» (puede tardar unas horas en propagarse):</p>
                <dl>
                  <dt>Tipo</dt>
                  <dd className="mono">TXT</dd>
                  <dt>Nombre</dt>
                  <dd className="mono">{b.txt.name}</dd>
                  <dt>Valor</dt>
                  <dd className="mono" style={{ overflowWrap: "anywhere" }}>
                    {b.txt.value}
                  </dd>
                </dl>
                <div className="row">
                  <button className="btn" type="button" onClick={() => void verify.run()} disabled={verify.pending}>
                    {verify.pending ? "Verificando…" : "Verificar"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        <ErrorAlert error={setDom.error ?? verify.error} />
      </section>
    </Page>
  );
}

// ---------------------------------------------------------------- Cupones (backoffice)

/** CUPONES: descuentos de lanzamiento, becas, convenios. Los personales (bienvenida, premios) no se listan. */
export function CouponsPage() {
  const api = useBackoffice();
  const list = useAsync(() => api.coupons(), [api]);
  const empty: NewCoupon = { code: "", description: "", kind: "percent", value: 10, planIds: [], maxRedemptions: null, durationCycles: 1, newCustomersOnly: true };
  const [form, setForm] = useState<NewCoupon>(empty);
  const [plans, setPlans] = useState("");
  const create = useAction(async () => {
    await api.createCoupon({ ...form, code: form.code.trim().toUpperCase(), description: form.description.trim(), planIds: plans.split(/[\s,]+/).filter(Boolean) });
    setForm(empty);
    setPlans("");
    await list.reload();
    return true;
  });
  const off = useAction(async (code: string) => {
    await api.deactivateCoupon(code);
    await list.reload();
  });
  const ready = /^[A-Za-z0-9-]{3,30}$/.test(form.code.trim()) && form.description.trim() && form.value > 0 && (form.kind === "fixed" || form.value <= 100);
  return (
    <Page title="Cupones" lead="Descuentos de lanzamiento, becas para periodistas y convenios.">
      <details className="card">
        <summary>Nuevo cupón</summary>
        <form
          className="stack"
          noValidate
          style={{ marginTop: "var(--space-4)" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void create.run();
          }}
        >
          <div className="grid-2">
            <Field label="Código" hint="3 a 30 letras, números o guiones.">{(p) => <input {...p} className="input mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />}</Field>
            <Field label="Descripción">{(p) => <input {...p} className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}</Field>
            <Field label="Tipo">
              {(p) => (
                <select {...p} className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as NewCoupon["kind"] })}>
                  <option value="percent">Porcentaje</option>
                  <option value="fixed">Monto fijo</option>
                </select>
              )}
            </Field>
            <Field label={form.kind === "percent" ? "Porcentaje (1 a 100)" : "Monto"}>{(p) => <input {...p} className="input" type="number" min={1} value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />}</Field>
            <Field label="Planes (vacío = todos)" hint="Ids separados por coma: personal, profesional…">{(p) => <input {...p} className="input" value={plans} onChange={(e) => setPlans(e.target.value)} />}</Field>
            <Field label="Cuántos cobros cubre" hint="Vacío = siempre.">
              {(p) => <input {...p} className="input" type="number" min={1} value={form.durationCycles ?? ""} onChange={(e) => setForm({ ...form, durationCycles: e.target.value ? Number(e.target.value) : null })} />}
            </Field>
            <Field label="Máximo de usos" hint="Vacío = sin tope.">
              {(p) => <input {...p} className="input" type="number" min={1} value={form.maxRedemptions ?? ""} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value ? Number(e.target.value) : null })} />}
            </Field>
          </div>
          <label className="row">
            <input type="checkbox" checked={form.newCustomersOnly} onChange={(e) => setForm({ ...form, newCustomersOnly: e.target.checked })} /> Sólo para quien nunca pagó
          </label>
          <div className="row">
            <button className="btn" type="submit" disabled={create.pending || !ready}>
              Crear cupón
            </button>
          </div>
          <ErrorAlert error={create.error} />
        </form>
      </details>
      {list.loading && !list.data && <Spinner />}
      <ErrorAlert error={list.error ?? off.error} />
      {list.data && list.data.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <caption>Cupones</caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Descuento</th>
                <th scope="col">Usos</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.code}>
                  <th scope="row">
                    <span className="mono">{c.code}</span>
                    <br />
                    <span className="muted">{c.description}</span>
                  </th>
                  <td>
                    {c.kind === "percent" ? `${c.value} %` : `${c.value} ${c.currency ?? ""}`}
                    {c.planIds.length ? ` · ${c.planIds.join(", ")}` : ""}
                  </td>
                  <td>
                    {c.redemptions}
                    {c.maxRedemptions !== null ? ` de ${c.maxRedemptions}` : ""}
                  </td>
                  <td>
                    {c.active ? (
                      <button className="btn btn--ghost btn--small" type="button" onClick={() => void off.run(c.code)} disabled={off.pending} aria-label={`Desactivar el cupón ${c.code}`}>
                        Desactivar
                      </button>
                    ) : (
                      <span className="badge badge--neutral">Inactivo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

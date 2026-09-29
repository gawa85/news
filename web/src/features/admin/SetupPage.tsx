import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useBackoffice } from "../../api/BackofficeContext";
import type { PlatformProfile, SetupCheck } from "../../api/backofficeTypes";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { GuideView } from "./GuideView";
import { guideFor } from "./setupGuides";

const GROUPS: Record<SetupCheck["group"], string> = {
  empresa: "Empresa",
  legal: "Legales",
  servidor: "Servidor",
  canales: "Canales",
  cobros: "Cobros y planes",
  operacion: "Operación",
  contenido: "Contenido",
};
const STATUS: Record<SetupCheck["status"], { label: string; badge: string }> = {
  ok: { label: "Listo", badge: "badge--fact" },
  warn: { label: "Revisar", badge: "badge--neutral" },
  todo: { label: "Falta", badge: "badge--danger" },
  optional: { label: "Opcional", badge: "badge--neutral" },
};

/**
 * PUESTA EN MARCHA: los datos de la empresa y lo que falta para abrir al público. La lista sale
 * del estado real (configuración, base, copias): se actualiza sola.
 */
export function SetupPage() {
  const api = useBackoffice();
  const data = useAsync(() => api.setup(), [api]);
  const d = data.data;
  const required = d?.checks.filter((c) => c.status !== "optional") ?? [];
  const ready = required.filter((c) => c.status === "ok").length;
  return (
    <Page title="Puesta en marcha" lead="Lo que falta para abrir Sin Humo al público. Cada punto dice qué hacer y dónde.">
      {data.loading && !d && <Spinner />}
      <ErrorAlert error={data.error} />
      {d && (
        <>
          <section className="card" aria-labelledby="progreso">
            <h2 id="progreso" style={{ margin: 0 }}>
              {ready} de {required.length} listos
            </h2>
            <progress max={required.length} value={ready} aria-labelledby="progreso" style={{ width: "100%" }} />
          </section>
          <ConfigExplainer />
          <ProfileForm profile={d.profile} onSaved={() => void data.reload()} />
          {(Object.keys(GROUPS) as SetupCheck["group"][]).map((g) => {
            const items = d.checks.filter((c) => c.group === g);
            if (!items.length) return null;
            return (
              <section key={g} className="card stack" aria-labelledby={`grupo-${g}`}>
                <h2 id={`grupo-${g}`} style={{ margin: 0 }}>
                  {GROUPS[g]}
                </h2>
                <ul className="plain-list stack">
                  {items.map((c) => (
                    <li key={c.id}>
                      <p style={{ margin: 0 }}>
                        <span className={`badge ${STATUS[c.status].badge}`}>{STATUS[c.status].label}</span> <strong>{c.title}</strong>
                      </p>
                      <p className="muted" style={{ margin: "var(--space-1) 0 0" }}>
                        {c.detail}{" "}
                        {c.action?.href &&
                          (c.action.href.startsWith("#") ? (
                            <a href={c.action.href}>{c.action.label}</a>
                          ) : (
                            <Link to={c.action.href}>
                              {c.action.label}
                              <span className="visually-hidden">: {c.title}</span>
                            </Link>
                          ))}
                      </p>
                      {guideFor(c.id) && (
                        <details>
                          <summary>
                            Cómo se hace, paso a paso<span className="visually-hidden">: {c.title}</span>
                          </summary>
                          <GuideView guide={guideFor(c.id)!} name={c.title} />
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </Page>
  );
}

function ProfileForm({ profile, onSaved }: { profile: PlatformProfile | null; onSaved: () => void }) {
  const api = useBackoffice();
  const [legalName, setLegalName] = useState(profile?.legalName ?? "");
  const [taxId, setTaxId] = useState(profile?.taxId ?? "");
  const [address, setAddress] = useState(profile?.address ?? "");
  const [contactEmail, setContactEmail] = useState(profile?.contactEmail ?? "");
  const [registry, setRegistry] = useState(profile?.dataRegistryNumber ?? "");
  const [age, setAge] = useState<string>(profile?.minimumAge ? String(profile.minimumAge) : "");
  const [tried, setTried] = useState(false);
  const save = useAction(async () => {
    const p = await api.saveSetupProfile({
      legalName: legalName.trim(), taxId: taxId.trim(), address: address.trim(), contactEmail: contactEmail.trim(),
      dataRegistryNumber: registry.trim() || undefined, minimumAge: age ? (Number(age) as 13 | 16 | 18) : undefined,
    });
    onSaved();
    return p;
  });
  const fill = useAction(() => api.fillLegal());
  const cuitOk = /^\d{2}-?\d{8}-?\d$/.test(taxId.trim());
  const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const ready = legalName.trim() && address.trim() && cuitOk && mailOk;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (ready) void save.run();
  };
  return (
    <section id="empresa" className="card stack" aria-labelledby="datos-empresa">
      <h2 id="datos-empresa" style={{ margin: 0 }}>
        Datos de la empresa
      </h2>
      <p className="muted" style={{ margin: 0 }}>
        Van en los términos, la privacidad y las facturas.
      </p>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="grid-2">
          <Field label="Razón social" error={tried && !legalName.trim() ? "Falta la razón social." : undefined}>
            {(p) => <input {...p} className="input" value={legalName} onChange={(e) => setLegalName(e.target.value)} />}
          </Field>
          <Field label="CUIT" hint="Con o sin guiones." error={tried && !cuitOk ? "Son 11 dígitos." : undefined}>
            {(p) => <input {...p} className="input" inputMode="numeric" value={taxId} onChange={(e) => setTaxId(e.target.value)} />}
          </Field>
          <Field label="Domicilio legal" error={tried && !address.trim() ? "Falta el domicilio." : undefined}>
            {(p) => <input {...p} className="input" value={address} onChange={(e) => setAddress(e.target.value)} />}
          </Field>
          <Field label="Mail de contacto" hint="Para consultas y pedidos sobre datos personales." error={tried && !mailOk ? "Revisá el mail." : undefined}>
            {(p) => <input {...p} className="input" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />}
          </Field>
          <Field label="Registro de bases de datos (opcional)" hint="Número de inscripción ante la AAIP.">
            {(p) => <input {...p} className="input" value={registry} onChange={(e) => setRegistry(e.target.value)} />}
          </Field>
          <Field label="Edad mínima (opcional)">
            {(p) => (
              <select {...p} className="input" value={age} onChange={(e) => setAge(e.target.value)}>
                <option value="">(sin definir)</option>
                <option value="13">13 años</option>
                <option value="16">16 años</option>
                <option value="18">18 años</option>
              </select>
            )}
          </Field>
        </div>
        <div className="row">
          <button className="btn btn--small" type="submit" disabled={save.pending}>
            Guardar datos
          </button>
        </div>
        <ErrorAlert error={save.error} />
      </form>
      {(profile || save.result) && (
        <div className="stack">
          <p style={{ margin: 0 }}>
            Completar los términos y la privacidad con estos datos: se publica una versión nueva como <strong>borrador</strong> (plazos y proveedores quedan para la revisión
            legal).
          </p>
          <div className="row">
            <button className="btn btn--secondary btn--small" type="button" disabled={fill.pending} onClick={() => void fill.run()}>
              Completar términos y privacidad
            </button>
          </div>
          <ErrorAlert error={fill.error} />
          {fill.result && (
            <Notice tone="ok" title={fill.result.published.length ? "Listo" : "Ya estaban completos"}>
              {fill.result.published.length > 0 && (
                <p>Se publicaron borradores nuevos de {fill.result.published.map((p) => (p.docId === "terms" ? "términos" : "privacidad")).join(" y ")}.</p>
              )}
              {Object.entries(fill.result.remaining).map(([doc, left]) =>
                left.length ? (
                  <p key={doc}>
                    En {doc === "terms" ? "términos" : "privacidad"} quedan para la revisión legal: {left.join(", ")}.
                  </p>
                ) : null,
              )}
              <p>
                <Link to="/admin/legal">Ver y publicar los documentos</Link>
              </p>
            </Notice>
          )}
        </div>
      )}
    </section>
  );
}

/** Qué es el archivo de configuración y cómo se aplica un cambio (para quien no maneja servidores). */
function ConfigExplainer() {
  return (
    <details className="card">
      <summary>
        <strong>¿Qué es «el archivo de configuración» y cómo se cambia?</strong>
      </summary>
      <div className="stack guide">
        <p>
          Algunas cosas (el mail, WhatsApp, las copias…) no se configuran desde esta web sino en un archivo de texto del servidor llamado <code>.env</code>. Tiene un
          renglón por dato, con la forma <code>NOMBRE=valor</code>. Por ejemplo: <code>SMTP_HOST=smtp-relay.brevo.com</code>.
        </p>
        <p>Guarda claves y contraseñas: por eso no se muestra ni se edita desde la web.</p>
        <ol>
          <li>Si no manejás el servidor vos, mandale la guía del punto que falta a quien lo hace.</li>
          <li>
            Está en la carpeta de Sin Humo del servidor, junto a <code>docker-compose.yml</code>. Se abre con cualquier editor de texto.
          </li>
          <li>Agregá o cambiá los renglones que dice la guía (hay un ejemplo para copiar) y guardá.</li>
          <li>
            Reiniciá Sin Humo para que tome los cambios: <code>docker compose up -d</code>. Después, volvé a esta página: la lista se actualiza sola.
          </li>
        </ol>
      </div>
    </details>
  );
}

import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import { useBackoffice } from "../../api/BackofficeContext";
import type { CorrectionTarget } from "../../api/backofficeTypes";
import { formatDate } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { useOutlets } from "../shared/catalog";

const TARGETS: Record<CorrectionTarget, { label: string; ref: string }> = {
  verdict: { label: "Un veredicto sobre una afirmación", ref: "Id de la afirmación" },
  credibility: { label: "Una evaluación de credibilidad", ref: "Tema (y dimensión, si aplica)" },
  reply: { label: "Una respuesta publicada", ref: "Id de la respuesta" },
  analysis: { label: "Un análisis", ref: "Id del análisis o descripción" },
  methodology: { label: "La metodología", ref: "Qué parte (p. ej. ponderación de fuentes)" },
  other: { label: "Otra cosa", ref: "A qué se refiere" },
};
const MIN = 20;
const MAX = 2000;

/** FE DE ERRATAS: la plataforma corrige públicamente un error propio (las que salen de una réplica se publican solas). */
export function CorrectionsAdminPage() {
  const api = useApi();
  const bo = useBackoffice();
  const recent = useAsync(() => api.corrections(), [api]);
  const { list: outlets, nameOf } = useOutlets();
  const [type, setType] = useState<CorrectionTarget>("verdict");
  const [ref, setRef] = useState("");
  const [outletId, setOutletId] = useState("");
  const [description, setDescription] = useState("");
  const [tried, setTried] = useState(false);
  const publish = useAction(async () => {
    const c = await bo.publishCorrection({ target: { type, id: ref.trim() }, outletId: outletId || undefined, description: description.trim() });
    setRef("");
    setDescription("");
    setTried(false);
    void recent.reload();
    return c;
  });
  const len = description.trim().length;
  const ready = ref.trim() && len >= MIN && len <= MAX;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (ready) void publish.run();
  };
  return (
    <Page title="Fe de erratas" lead="Corregir en público un error propio. Se publica enseguida en la fe de erratas, con fecha y sin quién la escribió.">
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="grid-2">
          <Field label="Qué se corrige">
            {(p) => (
              <select {...p} className="input" value={type} onChange={(e) => setType(e.target.value as CorrectionTarget)}>
                {(Object.keys(TARGETS) as CorrectionTarget[]).map((t) => (
                  <option key={t} value={t}>
                    {TARGETS[t].label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={TARGETS[type].ref} error={tried && !ref.trim() ? "Falta la referencia." : undefined}>
            {(p) => <input {...p} className="input" value={ref} onChange={(e) => setRef(e.target.value)} />}
          </Field>
          <Field label="Medio (si corresponde)">
            {(p) => (
              <select {...p} className="input" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                <option value="">(ninguno)</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field
          label="Qué estaba mal y cómo queda"
          hint={`Se publica tal cual. Entre ${MIN} y ${MAX} caracteres (van ${len}).`}
          error={tried && len < MIN ? `Describí la corrección (al menos ${MIN} caracteres).` : len > MAX ? `Máximo ${MAX} caracteres.` : undefined}
        >
          {(p) => <textarea {...p} className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <div className="row">
          <button className="btn btn--small" type="submit" disabled={publish.pending}>
            Publicar la corrección
          </button>
        </div>
        <ErrorAlert error={publish.error} />
        {publish.result && (
          <Notice tone="ok">
            <p>
              Publicada. Se ve en la <Link to="/fe-de-erratas">fe de erratas</Link>.
            </p>
          </Notice>
        )}
      </form>
      <section className="card stack" aria-labelledby="erratas-recientes">
        <h2 id="erratas-recientes">Publicadas hace poco</h2>
        {recent.loading && !recent.data && <Spinner />}
        <ErrorAlert error={recent.error} />
        {recent.data && recent.data.length === 0 && <p className="muted">Todavía no hay correcciones.</p>}
        <ul className="plain-list stack">
          {(recent.data ?? []).slice(0, 10).map((c) => (
            <li key={c.id}>
              <span className="muted">
                {formatDate(c.publishedAt)}
                {c.outletId && ` · ${nameOf(c.outletId)}`}
                {c.rebuttalId && " · por réplica"}
              </span>
              <br />
              {c.description}
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}

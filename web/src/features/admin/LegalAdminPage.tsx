import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useApi } from "../../api/ApiContext";
import { useBackoffice } from "../../api/BackofficeContext";
import type { LegalDocument } from "../../api/types";
import { formatDate } from "../../domain/labels";
import { Markdown } from "../../ui/Markdown";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const DOCS = [
  { id: "terms" as const, label: "Términos y condiciones", slug: "terminos" },
  { id: "privacy" as const, label: "Política de privacidad", slug: "privacidad" },
];
const MIN_BODY = 200;

/**
 * DOCUMENTOS LEGALES: publicar una versión nueva de términos o privacidad. Cada publicación es
 * una versión nueva (las anteriores quedan, con quién aceptó cuál).
 */
export function LegalAdminPage() {
  const [docId, setDocId] = useState<"terms" | "privacy">("terms");
  return (
    <Page title="Documentos legales" lead="Publicar una versión nueva no borra las anteriores: cada aceptación dice qué versión se aceptó.">
      <Field label="Documento">
        {(p) => (
          <select {...p} className="input" value={docId} onChange={(e) => setDocId(e.target.value as "terms" | "privacy")}>
            {DOCS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <LegalEditor key={docId} docId={docId} />
    </Page>
  );
}

function LegalEditor({ docId }: { docId: "terms" | "privacy" }) {
  const api = useApi();
  const current = useAsync(() => api.legalDocument(docId), [api, docId]);
  return (
    <>
      {current.loading && !current.data && <Spinner />}
      <ErrorAlert error={current.error} />
      {current.data && <LegalForm key={current.data.version} doc={current.data} onPublished={() => void current.reload()} />}
    </>
  );
}

function LegalForm({ doc, onPublished }: { doc: LegalDocument; onPublished: () => void }) {
  const bo = useBackoffice();
  const [title, setTitle] = useState(doc.title);
  const [summary, setSummary] = useState(doc.summary);
  const [body, setBody] = useState(doc.body ?? "");
  const [material, setMaterial] = useState(false);
  const [draft, setDraft] = useState(doc.draft);
  const [reviewed, setReviewed] = useState(false);
  const [preview, setPreview] = useState(false);
  const [tried, setTried] = useState(false);
  const slug = DOCS.find((d) => d.id === doc.id)!.slug;
  const publish = useAction(async () => {
    const r = await bo.publishLegal(doc.id, { title: title.trim(), summary: summary.trim(), body: body.trim(), material, draft });
    onPublished();
    return r;
  });
  const bodyOk = body.trim().length >= MIN_BODY;
  const ready = title.trim() && summary.trim() && bodyOk && (draft || reviewed);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (ready) void publish.run();
  };
  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <p className="muted" style={{ margin: 0 }}>
        Vigente: versión {doc.version}
        {doc.publishedAt && ` del ${formatDate(doc.publishedAt)}`}
        {doc.draft && " (borrador)"} · <Link to={`/legal/${slug}`}>ver la página pública</Link>
      </p>
      <div className="grid-2">
        <Field label="Título" error={tried && !title.trim() ? "Falta el título." : undefined}>
          {(p) => <input {...p} className="input" value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Resumen" hint="Aparece en el aviso para aceptar." error={tried && !summary.trim() ? "Falta el resumen." : undefined}>
          {(p) => <input {...p} className="input" value={summary} onChange={(e) => setSummary(e.target.value)} />}
        </Field>
      </div>
      <Field
        label="Texto completo"
        hint="Markdown simple: # títulos, - listas, > citas, **negrita**. Sin HTML."
        error={tried && !bodyOk ? `El texto es demasiado corto (al menos ${MIN_BODY} caracteres).` : undefined}
      >
        {(p) => <textarea {...p} className="input mono" rows={16} value={body} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      <div className="row">
        <button className="btn btn--ghost btn--small" type="button" aria-expanded={preview} onClick={() => setPreview(!preview)}>
          {preview ? "Ocultar vista previa" : "Ver cómo queda"}
        </button>
      </div>
      {preview && (
        <section className="card card--flat prose" aria-label="Vista previa">
          <Markdown text={body} />
        </section>
      )}
      <fieldset className="stack">
        <legend>Cómo se publica</legend>
        <label className="row">
          <input type="checkbox" checked={material} onChange={(e) => setMaterial(e.target.checked)} />
          Cambio importante: todas las personas tienen que volver a aceptar
        </label>
        <label className="row">
          <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
          Es un borrador (se muestra el aviso de que falta la revisión legal)
        </label>
        {!draft && (
          <label className="row">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            Lo revisó un/a abogado/a matriculado/a
          </label>
        )}
        {tried && !draft && !reviewed && (
          <p className="field__error" role="alert">
            Sin revisión legal, publicalo como borrador.
          </p>
        )}
      </fieldset>
      <div className="row">
        <button className="btn btn--small" type="submit" disabled={publish.pending}>
          Publicar versión nueva
        </button>
      </div>
      <ErrorAlert error={publish.error} />
      {publish.result && (
        <Notice tone="ok">
          <p>
            Publicada la versión {publish.result.version}.{material ? " Se va a pedir aceptarla de nuevo." : ""}
          </p>
        </Notice>
      )}
    </form>
  );
}

import { Link, useParams, useSearchParams } from "react-router";
import { useApi } from "../../api/ApiContext";
import { formatDate } from "../../domain/labels";
import { Markdown } from "../../ui/Markdown";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAsync } from "../../ui/useAsync";
import { NotFoundPage } from "../home/NotFoundPage";

const DOCS: Record<string, { id: "terms" | "privacy"; other: string; otherLabel: string }> = {
  terminos: { id: "terms", other: "privacidad", otherLabel: "Política de privacidad" },
  privacidad: { id: "privacy", other: "terminos", otherLabel: "Términos y condiciones" },
};

/** TÉRMINOS Y PRIVACIDAD: la versión vigente, y cualquier versión anterior (lo que alguien aceptó). */
export function LegalPage() {
  const { slug = "" } = useParams();
  const doc = DOCS[slug];
  if (!doc) return <NotFoundPage />;
  return <LegalDocumentView key={slug} slug={slug} docId={doc.id} other={doc.other} otherLabel={doc.otherLabel} />;
}

function LegalDocumentView({ slug, docId, other, otherLabel }: { slug: string; docId: "terms" | "privacy"; other: string; otherLabel: string }) {
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const version = params.get("version") ?? undefined;
  const doc = useAsync(() => api.legalDocument(docId, version), [api, docId, version]);
  const versions = useAsync(() => api.legalVersions(docId), [api, docId]);
  const d = doc.data;
  const current = versions.data?.[0]?.version;
  return (
    <Page title={d?.title ?? "Documento legal"} narrow>
      {doc.loading && !d && <Spinner />}
      <ErrorAlert error={doc.error} title="No encontramos esa versión" />
      {d && (
        <>
          <p className="muted">
            Versión {d.version}
            {d.publishedAt && ` · publicada el ${formatDate(d.publishedAt)}`}
            {current && d.version !== current && " · no es la vigente"}
          </p>
          {current && d.version !== current && (
            <Notice title="Estás viendo una versión anterior">
              <p>
                <Link to={`/legal/${slug}`}>Ver la versión vigente</Link>
              </p>
            </Notice>
          )}
          {d.draft && (
            <Notice title="Borrador">
              <p>Este texto todavía no fue revisado por un/a abogado/a. Puede cambiar.</p>
            </Notice>
          )}
          {versions.data && versions.data.length > 1 && (
            <Field label="Otras versiones">
              {(p) => (
                <select {...p} className="input" value={d.version} onChange={(e) => setParams(e.target.value === current ? {} : { version: e.target.value })}>
                  {versions.data!.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version}
                      {v.version === current ? " (vigente)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <article className="prose">{d.body ? <Markdown text={d.body} /> : <p>{d.summary}</p>}</article>
          <p>
            <Link to={`/legal/${other}`}>{otherLabel}</Link>
          </p>
        </>
      )}
    </Page>
  );
}

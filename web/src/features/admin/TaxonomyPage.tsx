import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { AdminCategory, AdminTopic, ReclassifyReport, TopicDraft } from "../../api/backofficeTypes";
import { formatDateTime } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const words = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const flatten = (cats: AdminCategory[]): AdminCategory[] => cats.flatMap((c) => [c, ...flatten(c.children)]);

/**
 * TEMAS Y CATEGORÍAS: con qué palabras se clasifica cada nota. Nada se borra: se desactiva
 * (las notas y estadísticas viejas siguen teniendo sentido).
 */
export function TaxonomyPage() {
  const api = useBackoffice();
  const tree = useAsync(() => api.taxonomy(), [api]);
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const cats = flatten(tree.data ?? []);
  const needle = q.trim().toLowerCase();
  const match = (t: AdminTopic) => (showInactive || t.active) && (!needle || [t.name, ...t.keywords, ...t.synonyms].some((w) => w.includes(needle)));
  const reload = () => void tree.reload();
  return (
    <Page title="Temas" lead="Cada tema clasifica las notas por sus palabras clave. Un nombre o sinónimo no puede significar dos temas.">
      {tree.loading && !tree.data && <Spinner />}
      <ErrorAlert error={tree.error} />
      {tree.data && (
        <>
          <section className="card stack" aria-labelledby="nuevo-tema">
            <h2 id="nuevo-tema">Nuevo tema</h2>
            <TopicForm categories={cats.filter((c) => c.active)} onSaved={reload} />
          </section>
          <section className="card stack" aria-labelledby="nueva-categoria">
            <h2 id="nueva-categoria">Nueva categoría</h2>
            <CategoryForm categories={cats.filter((c) => c.active)} onSaved={reload} />
          </section>
          <Reclassify />
          <section className="stack" aria-labelledby="todos-los-temas">
            <h2 id="todos-los-temas">Temas por categoría</h2>
            <div className="grid-2">
              <Field label="Buscar tema o palabra">{(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
              <label className="row">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                Mostrar también los desactivados
              </label>
            </div>
            {cats
              .filter((c) => showInactive || c.active)
              .map((c) => {
                const topics = c.topics.filter(match);
                if (needle && !topics.length) return null;
                return (
                  <div key={c.id} className="card card--flat stack">
                    <h3 style={{ margin: 0 }}>
                      {c.path} {!c.active && <span className="badge badge--neutral">Desactivada</span>}
                    </h3>
                    {c.description && <p className="muted" style={{ margin: 0 }}>{c.description}</p>}
                    <CategoryToggle c={c} onSaved={reload} />
                    {topics.length === 0 && c.children.length > 0 ? null : topics.length === 0 ? (
                      <p className="muted">Sin temas{showInactive ? "" : " activos"}.</p>
                    ) : (
                      <ul className="plain-list stack">
                        {topics.map((t) => (
                          <TopicItem key={t.id} t={t} categories={cats.filter((x) => x.active)} onSaved={reload} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
          </section>
        </>
      )}
    </Page>
  );
}

function TopicItem({ t, categories, onSaved }: { t: AdminTopic; categories: AdminCategory[]; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          <strong>{t.name}</strong> {!t.active && <span className="badge badge--neutral">Desactivado</span>} {t.sensitive && <span className="badge badge--danger">Sensible</span>}
        </span>
        <button className="btn btn--ghost btn--small" type="button" aria-expanded={editing} aria-label={`${editing ? "Cerrar" : "Editar"} ${t.name}`} onClick={() => setEditing(!editing)}>
          {editing ? "Cerrar" : "Editar"}
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Palabras clave: {t.keywords.join(", ")}
        {t.synonyms.length > 0 && ` · Sinónimos: ${t.synonyms.join(", ")}`}
        {t.countries.length > 0 && ` · Sólo en: ${t.countries.join(", ")}`}
        {t.updatedBy !== "sistema" && ` · Editado el ${formatDateTime(t.updatedAt)}`}
      </p>
      {editing && (
        <TopicForm
          topic={t}
          categories={categories}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
    </li>
  );
}

/** Alta o edición de un tema. Se manda el tema completo: lo que no se manda volvería al valor por defecto. */
function TopicForm({ topic, categories, onSaved }: { topic?: AdminTopic; categories: AdminCategory[]; onSaved: () => void }) {
  const api = useBackoffice();
  const [name, setName] = useState(topic?.name ?? "");
  const [categoryId, setCategoryId] = useState(topic?.categoryId ?? categories[0]?.id ?? "");
  const [keywords, setKeywords] = useState(topic?.keywords.join(", ") ?? "");
  const [synonyms, setSynonyms] = useState(topic?.synonyms.join(", ") ?? "");
  const [countries, setCountries] = useState(topic?.countries.join(", ") ?? "");
  const [sensitive, setSensitive] = useState(topic?.sensitive ?? false);
  const [active, setActive] = useState(topic?.active ?? true);
  const save = useAction(async (draft: TopicDraft) => {
    await api.saveTopic(draft);
    if (!topic) {
      setName("");
      setKeywords("");
      setSynonyms("");
      setCountries("");
    }
    onSaved();
    return true;
  });
  const ready = name.trim() && categoryId && words(keywords).length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) void save.run({ id: topic?.id, name: name.trim(), categoryId, keywords: words(keywords), synonyms: words(synonyms), countries: words(countries), sensitive, active });
  };
  const suffix = topic ? ` (${topic.name})` : "";
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="grid-2">
        <Field label={`Nombre${suffix}`}>{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={`Categoría${suffix}`}>
          {(p) => (
            <select {...p} className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.path}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={`Palabras clave${suffix}`} hint="Separadas por coma. Al menos una.">
          {(p) => <input {...p} className="input" value={keywords} onChange={(e) => setKeywords(e.target.value)} />}
        </Field>
        <Field label={`Sinónimos${suffix}`} hint="Otras formas de nombrarlo (separadas por coma).">
          {(p) => <input {...p} className="input" value={synonyms} onChange={(e) => setSynonyms(e.target.value)} />}
        </Field>
        <Field label={`Países${suffix}`} hint="Códigos (AR, UY…); vacío = todos.">
          {(p) => <input {...p} className="input" value={countries} onChange={(e) => setCountries(e.target.value.toUpperCase())} />}
        </Field>
      </div>
      <div className="row">
        <label className="row">
          <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
          Tema sensible (política, elecciones, salud)
        </label>
        {topic && (
          <label className="row">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Activo
          </label>
        )}
      </div>
      <div className="row">
        <button className="btn btn--small" type="submit" disabled={save.pending || !ready}>
          {topic ? "Guardar cambios" : "Crear tema"}
        </button>
      </div>
      <ErrorAlert error={save.error} />
      {save.result && !topic && (
        <Notice tone="ok">
          <p>Tema creado.</p>
        </Notice>
      )}
    </form>
  );
}

function CategoryForm({ categories, onSaved }: { categories: AdminCategory[]; onSaved: () => void }) {
  const api = useBackoffice();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const save = useAction(async () => {
    await api.saveCategory({ name: name.trim(), parentId: parentId || undefined, description: description.trim() || undefined, active: true });
    setName("");
    setDescription("");
    onSaved();
    return true;
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) void save.run();
  };
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="grid-2">
        <Field label="Nombre de la categoría">{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Dentro de">
          {(p) => (
            <select {...p} className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">(categoría principal)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.path}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Descripción (opcional)">{(p) => <input {...p} className="input" value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      </div>
      <div className="row">
        <button className="btn btn--small" type="submit" disabled={save.pending || !name.trim()}>
          Crear categoría
        </button>
      </div>
      <ErrorAlert error={save.error} />
      {save.result && (
        <Notice tone="ok">
          <p>Categoría creada.</p>
        </Notice>
      )}
    </form>
  );
}

/** Desactivar o reactivar una categoría (con temas activos adentro, el servidor no deja). */
function CategoryToggle({ c, onSaved }: { c: AdminCategory; onSaved: () => void }) {
  const api = useBackoffice();
  const toggle = useAction(async () => {
    await api.saveCategory({ id: c.id, name: c.name, parentId: c.parentId, description: c.description, active: !c.active });
    onSaved();
  });
  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn--ghost btn--small" type="button" aria-label={`${c.active ? "Desactivar" : "Reactivar"} la categoría ${c.name}`} disabled={toggle.pending} onClick={() => void toggle.run()}>
          {c.active ? "Desactivar" : "Reactivar"}
        </button>
      </div>
      <ErrorAlert error={toggle.error} />
    </div>
  );
}

/** Volver a clasificar las notas ya guardadas con los temas de hoy (las viejas no se enteran solas). */
function Reclassify() {
  const api = useBackoffice();
  const [scope, setScope] = useState<"otros" | "todas">("otros");
  const run = useAction((s: "otros" | "todas") => api.reclassifyArticles(s));
  const r: ReclassifyReport | undefined = run.result;
  return (
    <section className="card stack" aria-labelledby="reclasificar">
      <h2 id="reclasificar">Volver a clasificar las notas</h2>
      <p className="muted" style={{ margin: 0 }}>
        Cada nota recibe su tema cuando se lee. Si sumaste temas o palabras clave, las notas que ya estaban no se enteran: este botón las revisa de nuevo con los temas de hoy.
      </p>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field__label">¿Qué notas revisar?</legend>
        <label className="row">
          <input type="radio" name="reclasificar-alcance" checked={scope === "otros"} onChange={() => setScope("otros")} />
          Sólo las que quedaron sin tema ("otros"). Lo que ya tenía tema no se mueve.
        </label>
        <label className="row">
          <input type="radio" name="reclasificar-alcance" checked={scope === "todas"} onChange={() => setScope("todas")} />
          Todas (por ejemplo, después de corregir palabras clave que clasificaban mal).
        </label>
      </fieldset>
      <div>
        <button className="btn btn--secondary" type="button" disabled={run.pending} onClick={() => void run.run(scope)}>
          {run.pending ? "Clasificando…" : "Volver a clasificar"}
        </button>
      </div>
      <ErrorAlert error={run.error} title="No se pudo volver a clasificar" />
      {r && (
        <div role="status" className="stack">
          <p style={{ margin: 0 }}>
            {r.changed === 0 ? `Listo: se revisaron ${r.checked} nota(s) y ninguna cambió de tema.` : `Listo: se revisaron ${r.checked} nota(s) y ${r.changed} cambiaron de tema.`}
          </p>
          {r.byTopic.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Cómo quedaron las notas revisadas, por tema</caption>
                <thead>
                  <tr>
                    <th scope="col">Tema</th>
                    <th scope="col">Notas</th>
                  </tr>
                </thead>
                <tbody>
                  {r.byTopic.map((x) => (
                    <tr key={x.topic}>
                      <td>{x.topic === "otros" ? "otros (sin tema)" : x.topic}</td>
                      <td>{x.articles}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

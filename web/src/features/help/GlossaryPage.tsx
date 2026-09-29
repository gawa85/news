import { useState } from "react";
import { Field, Page } from "../../ui/components";
import { GLOSSARY } from "./glossary";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** GLOSARIO: las palabras técnicas de Sin Humo, explicadas en simple. */
export function GlossaryPage() {
  const [q, setQ] = useState("");
  const all = Object.values(GLOSSARY).sort((a, b) => a.term.localeCompare(b.term, "es"));
  const needle = norm(q.trim());
  const shown = all.filter((t) => !needle || norm(`${t.term} ${t.definition}`).includes(needle));
  return (
    <Page title="Glosario" lead="Las palabras que usamos en Sin Humo, explicadas sin tecnicismos." narrow>
      <Field label="Buscar una palabra">{(p) => <input {...p} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
      <p className="muted" role="status">
        {shown.length === all.length ? `${all.length} palabras.` : `${shown.length} de ${all.length} palabras.`}
      </p>
      <dl className="glossary">
        {shown.map((t) => (
          <div key={t.term} className="card card--flat">
            <dt>{t.term}</dt>
            <dd>
              <p>{t.definition}</p>
              {t.example && (
                <p className="muted">
                  <strong>Ejemplo:</strong> {t.example}
                </p>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Page>
  );
}

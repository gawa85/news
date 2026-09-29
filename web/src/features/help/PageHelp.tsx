import { Link } from "react-router";
import { GLOSSARY } from "./glossary";
import type { PageHelpContent } from "./helpContent";

/** "¿Cómo se usa esta pantalla?": cerrado de entrada, para no estorbar a quien ya sabe. */
export function PageHelp({ help }: { help: PageHelpContent }) {
  const terms = (help.terms ?? []).map((id) => GLOSSARY[id]).filter((t): t is NonNullable<typeof t> => !!t);
  return (
    <details className="card card--flat help">
      <summary>¿Cómo se usa esta pantalla?</summary>
      <div className="stack guide">
        <p>{help.summary}</p>
        {help.steps && (
          <ol>
            {help.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
        {help.example && (
          <p>
            <strong>Ejemplo:</strong> {help.example}
          </p>
        )}
        {terms.length > 0 && (
          <div>
            <p>
              <strong>Palabras de esta pantalla:</strong>
            </p>
            <dl className="env-list">
              {terms.map((t) => (
                <div key={t.term}>
                  <dt>{t.term}</dt>
                  <dd>{t.definition}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <p>
          <Link to="/glosario">Ver todas las palabras en el glosario</Link>
        </p>
      </div>
    </details>
  );
}

import { useState } from "react";
import { Notice } from "../../ui/components";
import type { Guide } from "./setupGuides";

/** Una guía: qué es, para qué, qué hace falta, los pasos y la configuración con ejemplos. */
export function GuideView({ guide, name }: { guide: Guide; name: string }) {
  return (
    <div className="stack guide">
      <p>
        <strong>Qué es:</strong> {guide.what}
      </p>
      {guide.why && (
        <p>
          <strong>Para qué sirve:</strong> {guide.why}
        </p>
      )}
      {guide.needs && (
        <div>
          <p>
            <strong>Qué necesitás antes:</strong>
          </p>
          <ul>
            {guide.needs.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p>
          <strong>Paso a paso:</strong>
        </p>
        <ol>
          {guide.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      {guide.env && <EnvExample lines={guide.env} name={name} />}
      {guide.warning && (
        <Notice title="Importante">
          <p>{guide.warning}</p>
        </Notice>
      )}
    </div>
  );
}

function EnvExample({ lines, name }: { lines: NonNullable<Guide["env"]>; name: string }) {
  const [copied, setCopied] = useState(false);
  const text = lines.map((l) => `${l.name}=${l.example}`).join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="stack">
      <p>
        <strong>En el archivo de configuración</strong> (reemplazá los ejemplos por tus datos):
      </p>
      <pre className="code-block" tabIndex={0} aria-label={`Ejemplo de configuración: ${name}`}>
        {text}
      </pre>
      <div className="row">
        <button className="btn btn--ghost btn--small" type="button" onClick={() => void copy()}>
          {copied ? "Copiado" : "Copiar el ejemplo"}
          <span className="visually-hidden"> de {name}</span>
        </button>
        <span className="visually-hidden" role="status">
          {copied ? "Ejemplo copiado" : ""}
        </span>
      </div>
      <dl className="env-list">
        {lines.map((l) => (
          <div key={l.name}>
            <dt>
              <code>{l.name}</code>
            </dt>
            <dd>{l.meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

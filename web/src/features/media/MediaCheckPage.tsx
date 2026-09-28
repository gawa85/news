import { useRef, useState, type FormEvent, type Ref } from "react";
import { useApi } from "../../api/ApiContext";
import type { MediaCheckReport } from "../../api/types";
import { formatDateTime } from "../../domain/labels";
import { ErrorAlert, Field, Page } from "../../ui/components";
import { useAction } from "../../ui/useAsync";

const MAX_MB = 20;

/**
 * ¿ES REAL ESTA FOTO O VIDEO? Se revisa sin mandarla a nadie: si ya circuló antes (huella) y qué
 * dicen sus datos internos (fecha, programa, marca de IA). El archivo no se guarda.
 */
export function MediaCheckPage() {
  const api = useApi();
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();
  const result = useRef<HTMLElement>(null);
  const check = useAction(async (f: File) => {
    const r = await api.checkMedia(f);
    setTimeout(() => result.current?.focus(), 0);
    return r;
  });
  const choose = (f: File | undefined) => {
    check.reset();
    setFile(f);
    setError(!f ? undefined : !/^(image|video)\//.test(f.type) ? "Elegí una foto o un video." : f.size > MAX_MB * 1024 * 1024 ? `El archivo pesa más de ${MAX_MB} MB.` : undefined);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file && !error) void check.run(file);
  };
  return (
    <Page title="¿Es real esta foto o video?" lead="Te decimos si ya circuló antes y qué dicen sus datos internos (fecha, programa con que se editó, marcas de inteligencia artificial). El archivo no se guarda.">
      <form className="card stack" onSubmit={submit} noValidate>
        <Field label="Foto o video" hint={`JPEG, PNG, WebP, MP4 o MOV, hasta ${MAX_MB} MB.`} error={error}>
          {(p) => <input {...p} className="input" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" onChange={(e) => choose(e.target.files?.[0])} />}
        </Field>
        <div className="row">
          <button className="btn" type="submit" disabled={!file || !!error || check.pending}>
            {check.pending ? "Revisando…" : "Revisar"}
          </button>
        </div>
        <p className="muted">
          Consejo: si te llegó por WhatsApp, pedí el original (WhatsApp borra los datos internos). Y buscá quién la publicó primero.
        </p>
      </form>
      <ErrorAlert error={check.error} />
      {check.result && <Report ref={result} r={check.result} />}
    </Page>
  );
}

function Report({ r, ref }: { r: MediaCheckReport; ref: Ref<HTMLElement> }) {
  const facts: [string, string][] = [
    ...(r.file.width && r.file.height ? [["Tamaño", `${r.file.width} × ${r.file.height} píxeles`] as [string, string]] : []),
    ...(r.file.seconds ? [["Duración", `${r.file.seconds} segundos`] as [string, string]] : []),
    ...(r.file.capturedAt ? [[r.kind === "image" ? "Tomada" : "Grabado", formatDateTime(r.file.capturedAt)] as [string, string]] : []),
    ...(r.file.device ? [["Cámara o teléfono", r.file.device] as [string, string]] : []),
    ...(r.file.software?.length ? [["Programa", r.file.software.join(", ")] as [string, string]] : []),
  ];
  const warnings = r.signals.filter((s) => s.level === "warning");
  return (
    <section ref={ref} tabIndex={-1} className="stack" aria-labelledby="revision">
      <h2 id="revision">Resultado</h2>
      <div className={`alert ${warnings.length ? "alert--error" : "alert--info"}`} role="status">
        <p className="alert__title">{r.summary}</p>
      </div>
      {r.signals.length > 0 && (
        <ul className="plain-list stack">
          {r.signals.map((s) => (
            <li key={s.id} className={s.level === "warning" ? "finding" : "card card--flat"}>
              <p style={{ margin: 0 }}>
                <span className={`badge ${s.level === "warning" ? "badge--smoke" : "badge--neutral"}`}>{s.level === "warning" ? "Ojo" : "Dato"}</span> <strong>{s.label}</strong>
              </p>
              <p style={{ margin: "var(--space-1) 0 0" }}>{s.detail}</p>
            </li>
          ))}
        </ul>
      )}
      {facts.length > 0 && (
        <div className="card table-wrap">
          <table className="table">
            <caption>Lo que dice el archivo</caption>
            <tbody>
              {facts.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">Ninguna de estas señales prueba por sí sola que sea falso: sirven para saber qué mirar.</p>
    </section>
  );
}

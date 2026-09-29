import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { AuditEntry, BackupManifest, CostReport } from "../../api/backofficeTypes";
import { formatDateTime, formatNumber } from "../../domain/labels";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";
import { isoDay } from "../shared/catalog";

const PAGE = 200;
const dayStart = (d: string) => new Date(`${d}T00:00:00-03:00`).toISOString();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999-03:00`).toISOString();

// ---------------- Auditoría ----------------

/** AUDITORÍA: quién hizo qué y cuándo (de la organización, o de toda la plataforma si el permiso alcanza). */
export function AuditPage() {
  const api = useBackoffice();
  const [from, setFrom] = useState(isoDay(7));
  const [to, setTo] = useState(isoDay(0));
  const [action, setAction] = useState("");
  const [filter, setFilter] = useState({ from: dayStart(isoDay(7)), to: dayEnd(isoDay(0)), action: "" });
  const [older, setOlder] = useState<AuditEntry[]>([]);
  const first = useAsync(() => api.audit(filter), [api, filter]);
  const entries = [...(first.data ?? []), ...older];
  const last = entries.at(-1);
  // Vienen de a 200, de la más nueva a la más vieja: "más viejas" pide hasta justo antes de la última.
  const more = useAction(async () => {
    const page = await api.audit({ ...filter, to: new Date(new Date(last!.at).getTime() - 1).toISOString() });
    setOlder((o) => [...o, ...page]);
    return page.length;
  });
  const exhausted = (first.data && first.data.length < PAGE) || (more.result !== undefined && more.result < PAGE);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOlder([]);
    more.reset();
    setFilter({ from: dayStart(from), to: dayEnd(to), action: action.trim() });
  };
  return (
    <Page title="Auditoría" lead="Cada acción importante queda registrada y no se puede modificar.">
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="grid-2">
          <Field label="Desde">{(p) => <input {...p} className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="Hasta">{(p) => <input {...p} className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Field label="Acción (opcional)" hint="Por ejemplo: taxonomy.changed">
            {(p) => <input {...p} className="input" value={action} onChange={(e) => setAction(e.target.value)} />}
          </Field>
        </div>
        <div className="row">
          <button className="btn btn--small" type="submit">
            Buscar
          </button>
        </div>
      </form>
      {first.loading && <Spinner />}
      <ErrorAlert error={first.error} />
      {first.data && entries.length === 0 && <p className="muted">No hay registros en ese período.</p>}
      {entries.length > 0 && (
        // (tabla ancha: la región se desplaza y tiene que poder enfocarse con el teclado)
        <div className="table-wrap card" role="region" aria-label="Registros de auditoría (se desplaza de costado)" tabIndex={0}>
          <table className="table">
            <caption className="visually-hidden">Registros de auditoría</caption>
            <thead>
              <tr>
                <th scope="col">Cuándo</th>
                <th scope="col">Qué</th>
                <th scope="col">Quién</th>
                <th scope="col">Sobre</th>
                <th scope="col">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.at)}</td>
                  <td className="mono">{e.action}</td>
                  <td className="mono">{e.actorId}</td>
                  <td>{e.target ? `${e.target.type} ${e.target.id}` : "—"}</td>
                  <td>
                    <Detail data={e.data} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries.length > 0 && !exhausted && (
        <div className="row">
          <button className="btn btn--ghost btn--small" type="button" disabled={more.pending} onClick={() => void more.run()}>
            Ver más antiguas
          </button>
        </div>
      )}
      <ErrorAlert error={more.error} />
    </Page>
  );
}

function Detail({ data }: { data: Record<string, unknown> }) {
  const keys = Object.keys(data);
  if (!keys.length) return <span className="muted">—</span>;
  return <span className="mono" style={{ wordBreak: "break-word" }}>{keys.map((k) => `${k}: ${typeof data[k] === "object" ? JSON.stringify(data[k]) : String(data[k])}`).join(" · ")}</span>;
}

// ---------------- Costos ----------------

const usd = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);

/** COSTOS Y MARGEN: cuánto cuesta atender a cada cliente (IA, mensajes, mails) frente a lo que paga. */
export function CostsPage() {
  const api = useBackoffice();
  const [from, setFrom] = useState(isoDay(30));
  const [to, setTo] = useState(isoDay(0));
  const report = useAsync(() => api.costs(dayStart(from), dayEnd(to)), [api, from, to]);
  return (
    <Page title="Costos" lead="Qué proveedor cuesta más y qué clientes cuestan más de lo que pagan (período de hasta un año).">
      <div className="card grid-2">
        <Field label="Desde">{(p) => <input {...p} className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="Hasta">{(p) => <input {...p} className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
      {report.loading && <Spinner />}
      <ErrorAlert error={report.error} />
      {report.data && <CostsView r={report.data} />}
    </Page>
  );
}

function CostsView({ r }: { r: CostReport }) {
  const providers = Object.entries(r.byProvider).sort((a, b) => b[1] - a[1]);
  const over = r.bySubject.filter((s) => s.overBudget).length;
  return (
    <div className="stack">
      <section className="card" aria-labelledby="costos-resumen">
        <h2 id="costos-resumen" className="visually-hidden">
          Resumen
        </h2>
        <dl className="stats">
          <div>
            <dt>Costo total</dt>
            <dd>{usd(r.totalCostUsd)}</dd>
          </div>
          <div>
            <dt>Ingreso del período</dt>
            <dd>{usd(r.totalRevenueUsd)}</dd>
          </div>
          <div>
            <dt>Margen</dt>
            <dd>{usd(r.totalRevenueUsd - r.totalCostUsd)}</dd>
          </div>
          <div>
            <dt>Clientes fuera de presupuesto</dt>
            <dd>{formatNumber(over)}</dd>
          </div>
        </dl>
      </section>
      <div className="table-wrap card">
        <table className="table">
          <caption>Por proveedor</caption>
          <thead>
            <tr>
              <th scope="col">Proveedor</th>
              <th scope="col">Costo</th>
            </tr>
          </thead>
          <tbody>
            {providers.length === 0 && (
              <tr>
                <td colSpan={2} className="muted">
                  Sin consumos en el período.
                </td>
              </tr>
            )}
            {providers.map(([p, c]) => (
              <tr key={p}>
                <th scope="row">{p}</th>
                <td>{usd(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-wrap card">
        <table className="table">
          <caption>Por cliente (los que más cuestan primero)</caption>
          <thead>
            <tr>
              <th scope="col">Cliente</th>
              <th scope="col">Plan</th>
              <th scope="col">Ingreso</th>
              <th scope="col">Costo</th>
              <th scope="col">Margen</th>
              <th scope="col">Estado</th>
            </tr>
          </thead>
          <tbody>
            {r.bySubject.map((s) => (
              <tr key={s.subjectId}>
                <th scope="row" className="mono">
                  {s.subjectId}
                </th>
                <td>{s.planId ?? "—"}</td>
                <td>{usd(s.revenueUsd)}</td>
                <td>{usd(s.costUsd)}</td>
                <td>{usd(s.marginUsd)}</td>
                <td>{s.overBudget ? <span className="badge badge--danger">Fuera de presupuesto</span> : <span className="badge badge--fact">Bien</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------- Copias de seguridad ----------------

const KIND: Record<BackupManifest["kind"], string> = { daily: "Diaria", manual: "Manual", pre_migration: "Antes de migrar", staging_copy: "Para pruebas" };
const size = (bytes: number) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB` : `${Math.ceil(bytes / 1000)} kB`);

/** COPIAS DE SEGURIDAD: cifradas; la prueba de restauración confirma que se pueden recuperar. */
export function BackupsPage() {
  const api = useBackoffice();
  const list = useAsync(() => api.backups(), [api]);
  const create = useAction(async () => {
    const m = await api.createBackup();
    list.setData([m, ...(list.data ?? [])]);
    return m;
  });
  const replace = (m: BackupManifest) => list.setData((list.data ?? []).map((x) => (x.key === m.key ? m : x)));
  return (
    <Page title="Copias de seguridad" lead="Se hace una por día y se verifica una por semana. Una copia sin verificar es una promesa, no una copia.">
      <section className="card stack" aria-labelledby="copia-ahora">
        <h2 id="copia-ahora">Copia ahora</h2>
        <p className="muted" style={{ margin: 0 }}>
          Lee toda la base: puede tardar. Mientras se hace una copia o una verificación, no se puede empezar otra.
        </p>
        <div className="row">
          <button className="btn btn--small" type="button" disabled={create.pending} onClick={() => void create.run()}>
            {create.pending ? "Copiando…" : "Hacer una copia"}
          </button>
        </div>
        <ErrorAlert error={create.error} />
        {create.result && (
          <Notice tone="ok">
            <p>Copia hecha ({size(create.result.bytes)}). Conviene verificarla.</p>
          </Notice>
        )}
      </section>
      {list.loading && !list.data && <Spinner />}
      <ErrorAlert error={list.error} />
      {list.data && list.data.length === 0 && <p className="muted">Todavía no hay copias.</p>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap card">
          <table className="table">
            <caption>Copias guardadas</caption>
            <thead>
              <tr>
                <th scope="col">Cuándo</th>
                <th scope="col">Tipo</th>
                <th scope="col">Tamaño</th>
                <th scope="col">Verificación</th>
                <th scope="col">
                  <span className="visually-hidden">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((m) => (
                <BackupRow key={m.key} m={m} onVerified={replace} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

function BackupRow({ m, onVerified }: { m: BackupManifest; onVerified: (m: BackupManifest) => void }) {
  const api = useBackoffice();
  const verify = useAction(async () => onVerified(await api.verifyBackup(m.key)));
  const docs = Object.values(m.collections).reduce((a, b) => a + b, 0);
  return (
    <tr>
      <th scope="row">
        {formatDateTime(m.createdAt)}
        <br />
        <span className="muted">
          {formatNumber(docs)} documentos · {m.engine}
        </span>
      </th>
      <td>{KIND[m.kind]}</td>
      <td>{size(m.bytes)}</td>
      <td>
        {!m.verification ? (
          <span className="badge badge--neutral">Sin verificar</span>
        ) : m.verification.ok ? (
          <span className="badge badge--fact">Se restaura bien</span>
        ) : (
          <span className="badge badge--danger">No se pudo restaurar</span>
        )}
        {m.verification && (
          <span className="muted">
            {" "}
            {m.verification.detail} ({formatDateTime(m.verifiedAt!)})
          </span>
        )}
      </td>
      <td>
        <button className="btn btn--ghost btn--small" type="button" aria-label={`Verificar la copia del ${formatDateTime(m.createdAt)}`} disabled={verify.pending} onClick={() => void verify.run()}>
          {verify.pending ? "Verificando…" : "Verificar"}
        </button>
        <ErrorAlert error={verify.error} />
      </td>
    </tr>
  );
}

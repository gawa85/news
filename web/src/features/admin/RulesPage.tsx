import { useState, type FormEvent } from "react";
import { useBackoffice } from "../../api/BackofficeContext";
import type { BusinessRule, ConditionField, ConditionOp, RuleCondition, RuleEffect, RuleScenario } from "../../api/backofficeTypes";
import { formatDateTime } from "../../domain/labels";
import { useSession } from "../../session/SessionContext";
import { ErrorAlert, Field, Notice, Page, Spinner } from "../../ui/components";
import { useAction, useAsync } from "../../ui/useAsync";

const FIELDS: Record<ConditionField, string> = {
  plan: "Plan", role: "Rol", channel: "Canal", action: "Acción", organization: "Organización", topic: "Tema",
  hour: "Hora (0-23)", weekday: "Día (0 = domingo)", account_age_days: "Antigüedad de la cuenta (días)", date: "Fecha (AAAA-MM-DD)",
};
const OPS: Record<ConditionOp, string> = { eq: "es", neq: "no es", in: "es alguno de", not_in: "no es ninguno de", gte: "≥", lte: "≤" };
const NUMERIC: ConditionField[] = ["hour", "weekday", "account_age_days"];
const STATUS: Record<BusinessRule["status"], [string, string]> = { draft: ["Borrador", "badge--smoke"], active: ["Activa", "badge--fact"], archived: ["Archivada", "badge--neutral"] };

/** Condición en palabras ("Plan es alguno de gratis, personal"). */
const conditionText = (c: RuleCondition) => `${FIELDS[c.field]} ${OPS[c.op]} ${Array.isArray(c.value) ? c.value.join(", ") : c.value}`;
const effectText = (e: RuleEffect) =>
  e.type === "deny" ? `Rechazar: «${e.message}»` : e.type === "limit" ? `Limitar ${e.metric} a ${e.max}` : `Habilitar la función ${e.feature}`;

/**
 * REGLAS DEL NEGOCIO: condiciones → efecto, sin programar. Una regla nueva o editada queda en
 * borrador; se prueba con escenarios y la APRUEBA OTRA PERSONA (cuatro ojos) antes de aplicarse.
 */
export function RulesPage() {
  const api = useBackoffice();
  const list = useAsync(() => api.rules(), [api]);
  const [openId, setOpenId] = useState<string>();
  const rules = (list.data ?? []).filter((r) => r.status !== "archived");
  const current = rules.find((r) => r.id === openId);
  return (
    <Page title="Reglas del negocio" lead="Se evalúan en cada pedido, de menor a mayor prioridad. Toda regla pasa por prueba y aprobación de otra persona.">
      <NewRule onSaved={(r) => (void list.reload(), setOpenId(r.id))} />
      {list.loading && !list.data && <Spinner />}
      <ErrorAlert error={list.error} />
      {list.data && rules.length === 0 && <p className="muted">No hay reglas.</p>}
      <ul className="plain-list stack">
        {rules.map((r) => (
          <li key={r.id} className="card card--flat">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span> <strong>{r.name}</strong> <span className="muted">· v{r.version} · prioridad {r.priority}</span>
              </span>
              <button className="btn btn--secondary btn--small" type="button" onClick={() => setOpenId(r.id === openId ? undefined : r.id)} aria-expanded={r.id === openId}>
                {r.id === openId ? "Cerrar" : "Ver"}
              </button>
            </div>
            <p className="muted" style={{ margin: "var(--space-2) 0 0" }}>
              Si {r.conditions.map(conditionText).join(" y ") || "siempre"} → {effectText(r.effect)}
            </p>
          </li>
        ))}
      </ul>
      {current && <RuleDetail key={`${current.id}:${current.version}`} r={current} onChange={() => void list.reload()} />}
    </Page>
  );
}

function RuleDetail({ r, onChange }: { r: BusinessRule; onChange: () => void }) {
  const api = useBackoffice();
  const { me } = useSession();
  const history = useAsync(() => api.ruleHistory(r.id), [api, r.id, r.version]);
  const [scenarios, setScenarios] = useState<RuleScenario[]>([{ name: "Caso que debería aplicar", facts: {}, expect: r.effect.type === "deny" ? "deny" : r.effect.type === "grant_feature" ? "grant" : "deny" }]);
  const test = useAction(async () => {
    const res = await api.testRule(r.id, scenarios);
    onChange();
    return res;
  });
  const approve = useAction(async () => {
    await api.approveRule(r.id);
    onChange();
  });
  const archive = useAction(async () => {
    await api.archiveRule(r.id);
    onChange();
  });
  const lastTest = test.result ?? r.lastTest;
  const own = r.createdBy === me?.id && r.scope.type === "platform";
  return (
    <section className="card stack" aria-labelledby="regla">
      <h2 id="regla">{r.name}</h2>
      {r.description && <p>{r.description}</p>}

      {r.status === "draft" && (
        <>
          <h3>Probar con escenarios</h3>
          <p className="muted">Cada escenario describe un pedido (plan, canal, acción…) y qué debería pasar. La regla se aprueba sólo si pasan todos.</p>
          {scenarios.map((s, i) => (
            <ScenarioRow key={i} s={s} n={i + 1} onChange={(next) => setScenarios(scenarios.map((x, j) => (j === i ? next : x)))} onRemove={scenarios.length > 1 ? () => setScenarios(scenarios.filter((_, j) => j !== i)) : undefined} />
          ))}
          <div className="row">
            <button className="btn btn--ghost btn--small" type="button" onClick={() => setScenarios([...scenarios, { name: `Escenario ${scenarios.length + 1}`, facts: {}, expect: "allow" }])}>
              Agregar escenario
            </button>
            <button className="btn btn--secondary" type="button" onClick={() => void test.run()} disabled={test.pending}>
              {test.pending ? "Probando…" : "Probar"}
            </button>
          </div>
          <ErrorAlert error={test.error} />
        </>
      )}

      {lastTest && (
        <div className={`alert ${lastTest.passed ? "alert--ok" : "alert--error"}`} role="status">
          <p className="alert__title">{lastTest.passed ? "Pasaron todos los escenarios" : "Falló algún escenario"}</p>
          <ul>
            {lastTest.results.map((x) => (
              <li key={x.name}>
                {x.ok ? "✔" : "✘"} {x.name}: esperado {x.expected}, dio {x.got}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row">
        {r.status === "draft" && (
          <button className="btn" type="button" onClick={() => void approve.run()} disabled={approve.pending || !lastTest?.passed || own} title={own ? "La aprueba otra persona" : undefined}>
            Aprobar y activar
          </button>
        )}
        <button className="btn btn--ghost" type="button" onClick={() => void archive.run()} disabled={archive.pending}>
          Archivar
        </button>
      </div>
      {r.status === "draft" && own && <p className="muted">La creaste vos: la tiene que aprobar otra persona.</p>}
      <ErrorAlert error={approve.error ?? archive.error} />

      <details>
        <summary>Historial de versiones</summary>
        {history.data && (
          <ol>
            {history.data.map((v) => (
              <li key={v.version}>
                v{v.version} · {STATUS[v.status][0]} · creada {formatDateTime(v.createdAt)}
                {v.approvedAt && ` · aprobada ${formatDateTime(v.approvedAt)}`}
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}

function ScenarioRow({ s, n, onChange, onRemove }: { s: RuleScenario; n: number; onChange: (s: RuleScenario) => void; onRemove?: () => void }) {
  const fact = (k: "plan" | "channel" | "action" | "topic") => (
    <Field label={`${FIELDS[k]} (escenario ${n})`}>
      {(p) => <input {...p} className="input" value={s.facts[k] ?? ""} onChange={(e) => onChange({ ...s, facts: { ...s.facts, [k]: e.target.value || undefined } })} />}
    </Field>
  );
  return (
    <fieldset className="card card--flat stack">
      <legend className="field__label">Escenario {n}</legend>
      <Field label={`Nombre (escenario ${n})`}>{(p) => <input {...p} className="input" value={s.name} onChange={(e) => onChange({ ...s, name: e.target.value })} />}</Field>
      <div className="grid-2">
        {fact("plan")}
        {fact("channel")}
        {fact("action")}
        {fact("topic")}
        <Field label={`Rol (escenario ${n})`}>
          {(p) => <input {...p} className="input" value={s.facts.roles?.join(", ") ?? ""} onChange={(e) => onChange({ ...s, facts: { ...s.facts, roles: e.target.value ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean) : undefined } })} />}
        </Field>
        <Field label={`Resultado esperado (escenario ${n})`}>
          {(p) => (
            <select {...p} className="select" value={s.expect} onChange={(e) => onChange({ ...s, expect: e.target.value as RuleScenario["expect"] })}>
              <option value="allow">Permite</option>
              <option value="deny">Rechaza</option>
              <option value="grant">Habilita la función</option>
            </select>
          )}
        </Field>
      </div>
      {onRemove && (
        <div className="row">
          <button className="btn btn--ghost btn--small" type="button" onClick={onRemove}>
            Quitar escenario {n}
          </button>
        </div>
      )}
    </fieldset>
  );
}

function NewRule({ onSaved }: { onSaved: (r: BusinessRule) => void }) {
  const api = useBackoffice();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(100);
  const [conditions, setConditions] = useState<{ field: ConditionField; op: ConditionOp; value: string }[]>([{ field: "plan", op: "eq", value: "" }]);
  const [effect, setEffect] = useState<{ type: RuleEffect["type"]; message: string; metric: string; max: number; feature: string }>({ type: "deny", message: "", metric: "analyses", max: 10, feature: "" });
  const save = useAction(async () => {
    const parse = (c: (typeof conditions)[number]): RuleCondition => {
      const list = c.op === "in" || c.op === "not_in";
      const conv = (x: string) => (NUMERIC.includes(c.field) ? Number(x) : x.trim());
      return { field: c.field, op: c.op, value: list ? c.value.split(",").map((x) => conv(x)).filter((x) => x !== "") : conv(c.value) };
    };
    const eff: RuleEffect =
      effect.type === "deny" ? { type: "deny", message: effect.message.trim() } : effect.type === "limit" ? { type: "limit", metric: effect.metric, max: effect.max, ...(effect.message.trim() ? { message: effect.message.trim() } : {}) } : { type: "grant_feature", feature: effect.feature.trim() };
    const r = await api.saveRule({ name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}), scope: { type: "platform" }, priority, conditions: conditions.filter((c) => c.value.trim()).map(parse), effect: eff });
    setName("");
    onSaved(r);
    return r;
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length >= 3) void save.run();
  };
  return (
    <details className="card">
      <summary>Nueva regla</summary>
      <form className="stack" onSubmit={submit} noValidate style={{ marginTop: "var(--space-4)" }}>
        <div className="grid-2">
          <Field label="Nombre">{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Prioridad" hint="Menor = se evalúa antes.">{(p) => <input {...p} className="input" type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value) || 100)} />}</Field>
        </div>
        <Field label="Descripción (para qué es)">{(p) => <input {...p} className="input" value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <fieldset className="stack">
          <legend className="field__label">Si se cumplen todas estas condiciones…</legend>
          {conditions.map((c, i) => (
            <div key={i} className="grid-2">
              <Field label={`Condición ${i + 1}: dato`}>
                {(p) => (
                  <select {...p} className="select" value={c.field} onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, field: e.target.value as ConditionField } : x)))}>
                    {(Object.keys(FIELDS) as ConditionField[]).map((f) => (
                      <option key={f} value={f}>
                        {FIELDS[f]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={`Condición ${i + 1}: comparación`}>
                {(p) => (
                  <select {...p} className="select" value={c.op} onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as ConditionOp } : x)))}>
                    {(Object.keys(OPS) as ConditionOp[]).map((o) => (
                      <option key={o} value={o}>
                        {OPS[o]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={`Condición ${i + 1}: valor`} hint={c.op === "in" || c.op === "not_in" ? "Separados por coma." : undefined}>
                {(p) => <input {...p} className="input" value={c.value} onChange={(e) => setConditions(conditions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />}
              </Field>
            </div>
          ))}
          <div className="row">
            <button className="btn btn--ghost btn--small" type="button" onClick={() => setConditions([...conditions, { field: "channel", op: "eq", value: "" }])}>
              Agregar condición
            </button>
          </div>
        </fieldset>
        <fieldset className="stack">
          <legend className="field__label">…entonces</legend>
          <Field label="Efecto">
            {(p) => (
              <select {...p} className="select" value={effect.type} onChange={(e) => setEffect({ ...effect, type: e.target.value as RuleEffect["type"] })}>
                <option value="deny">Rechazar el pedido</option>
                <option value="limit">Limitar el uso</option>
                <option value="grant_feature">Habilitar una función</option>
              </select>
            )}
          </Field>
          {effect.type !== "grant_feature" && (
            <Field label="Mensaje para la persona">{(p) => <input {...p} className="input" value={effect.message} onChange={(e) => setEffect({ ...effect, message: e.target.value })} />}</Field>
          )}
          {effect.type === "limit" && (
            <div className="grid-2">
              <Field label="Métrica">
                {(p) => (
                  <select {...p} className="select" value={effect.metric} onChange={(e) => setEffect({ ...effect, metric: e.target.value })}>
                    <option value="analyses">Análisis</option>
                    <option value="comparisons">Comparaciones</option>
                  </select>
                )}
              </Field>
              <Field label="Máximo">{(p) => <input {...p} className="input" type="number" min={0} value={effect.max} onChange={(e) => setEffect({ ...effect, max: Number(e.target.value) || 0 })} />}</Field>
            </div>
          )}
          {effect.type === "grant_feature" && (
            <Field label="Función (id)">{(p) => <input {...p} className="input mono" value={effect.feature} onChange={(e) => setEffect({ ...effect, feature: e.target.value })} />}</Field>
          )}
        </fieldset>
        <div className="row">
          <button className="btn" type="submit" disabled={save.pending || name.trim().length < 3}>
            Guardar borrador
          </button>
        </div>
        <ErrorAlert error={save.error} />
        {save.result && (
          <Notice tone="ok">
            <p>Borrador guardado. Probalo y pedile a otra persona que lo apruebe.</p>
          </Notice>
        )}
      </form>
    </details>
  );
}

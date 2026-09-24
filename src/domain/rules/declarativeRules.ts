/**
 * Motor de REGLAS DECLARATIVAS: funciones puras (sin base ni red), fáciles de probar.
 */
import {
  FEATURES,
  type AccessContext,
  type ConditionField,
  type DeclarativeOutcome,
  type DeclarativeRule,
  type RuleCondition,
  type RuleFacts,
  type RuleScenario,
} from "../model";

const FIELDS: Record<ConditionField, "text" | "number" | "list"> = {
  plan: "text", role: "list", channel: "text", action: "text", organization: "text", topic: "text",
  hour: "number", weekday: "number", account_age_days: "number", date: "text",
};

export function factsFrom(ctx: AccessContext, utcOffsetMinutes = -180): RuleFacts {
  const local = new Date(ctx.now.getTime() + utcOffsetMinutes * 60_000);
  return {
    plan: ctx.plan.id,
    roles: ctx.user.roleIds,
    channel: ctx.channel,
    action: ctx.action.id,
    organization: ctx.user.organizationId ?? "",
    topic: ctx.request.topic?.toLowerCase(),
    hour: local.getUTCHours(),
    weekday: local.getUTCDay(),
    account_age_days: Math.floor((ctx.now.getTime() - ctx.user.createdAt.getTime()) / 86_400_000),
    date: local.toISOString().slice(0, 10),
    usage: ctx.usage,
  };
}

export function matches(c: RuleCondition, f: Partial<RuleFacts>): boolean {
  const raw = f[(c.field === "role" ? "roles" : c.field) as keyof RuleFacts] as unknown;
  if (raw === undefined) return c.op === "neq" || c.op === "not_in";
  const values = Array.isArray(raw) ? (raw as (string | number)[]) : [raw as string | number];
  const target = Array.isArray(c.value) ? c.value : [c.value];
  const norm = (v: string | number) => (typeof v === "string" ? v.toLowerCase() : v);
  const anyEq = values.some((v) => target.some((t) => norm(t) === norm(v)));
  switch (c.op) {
    case "eq":
    case "in":
      return anyEq;
    case "neq":
    case "not_in":
      return !anyEq;
    case "gte":
      return values.some((v) => v >= target[0]!);
    case "lte":
      return values.some((v) => v <= target[0]!);
  }
}

/** ¿Está vigente en este momento? */
export function isLive(r: DeclarativeRule, now: Date): boolean {
  return r.status === "active" && (!r.validFrom || r.validFrom <= now) && (!r.validTo || r.validTo >= now);
}

/**
 * Evalúa las reglas activas (ya filtradas por alcance) en orden de prioridad.
 * Junta las funcionalidades regaladas y corta en la primera que bloquea o limita.
 */
export function evaluateDeclarative(rules: DeclarativeRule[], f: Partial<RuleFacts>, now: Date): DeclarativeOutcome {
  const out: DeclarativeOutcome = { grants: [] };
  for (const r of [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))) {
    if (!isLive(r, now) || !r.conditions.every((c) => matches(c, f))) continue;
    const e = r.effect;
    if (e.type === "grant_feature") {
      if (r.scope.type === "platform") out.grants.push({ feature: e.feature, ruleId: r.id });
    } else if (e.type === "deny") {
      out.denial ??= { code: "business_rule", message: e.message, ruleId: r.id };
    } else if (e.type === "limit") {
      const used = f.usage?.[e.metric] ?? 0;
      if (used + 1 > e.max) {
        out.denial ??= { code: "quota_exceeded", message: e.message ?? `Límite de ${e.max} ${e.metric === "analyses" ? "análisis" : "comparaciones"} para este caso.`, ruleId: r.id };
      }
    }
  }
  return out;
}

/** Errores de forma de una regla (vacío = válida). */
export function validateRule(r: Pick<DeclarativeRule, "name" | "scope" | "conditions" | "effect" | "validFrom" | "validTo" | "priority">): string[] {
  const errors: string[] = [];
  if (!r.name.trim()) errors.push("Falta el nombre.");
  if (!Number.isInteger(r.priority) || r.priority < 0 || r.priority > 10_000) errors.push("La prioridad tiene que ser un entero entre 0 y 10000.");
  if (r.conditions.length > 20) errors.push("Máximo 20 condiciones.");
  for (const c of r.conditions) {
    const kind = FIELDS[c.field];
    if (!kind) {
      errors.push(`Campo desconocido: ${String(c.field)}.`);
      continue;
    }
    if (!["eq", "neq", "in", "not_in", "gte", "lte"].includes(c.op)) errors.push(`Operador desconocido: ${String(c.op)}.`);
    if ((c.op === "in" || c.op === "not_in") !== Array.isArray(c.value)) errors.push(`"${c.op}" en ${c.field}: ${c.op.endsWith("in") ? "necesita una lista" : "no lleva lista"}.`);
    if ((c.op === "gte" || c.op === "lte") && (kind !== "number" && c.field !== "date")) errors.push(`"${c.op}" sólo sirve para números o fechas (${c.field}).`);
    if (kind === "number" && !(Array.isArray(c.value) ? c.value : [c.value]).every((v) => typeof v === "number")) errors.push(`${c.field} compara números.`);
  }
  const e = r.effect;
  if (e.type === "deny" && !e.message?.trim()) errors.push("Un bloqueo necesita un mensaje claro para la persona.");
  if (e.type === "limit" && (!Number.isInteger(e.max) || e.max < 0)) errors.push("El límite tiene que ser un entero ≥ 0.");
  if (e.type === "grant_feature") {
    if (!(FEATURES as readonly string[]).includes(e.feature)) errors.push(`Funcionalidad desconocida: ${e.feature}.`);
    if (r.scope.type !== "platform") errors.push("Sólo la plataforma puede regalar funcionalidades.");
    if (!r.validTo) errors.push("Una promoción necesita fecha de fin.");
  }
  if (r.validFrom && r.validTo && r.validTo <= r.validFrom) errors.push("La fecha de fin es anterior a la de inicio.");
  if (!r.conditions.length && e.type === "deny") errors.push("Un bloqueo sin condiciones bloquearía a todos: agregá al menos una.");
  return errors;
}

/** Prueba una regla (como si estuviera activa) contra escenarios. */
export function simulate(rule: DeclarativeRule, scenarios: RuleScenario[], now: Date): { name: string; expected: string; got: string; ok: boolean }[] {
  const live = { ...rule, status: "active" as const, validFrom: undefined, validTo: undefined };
  return scenarios.map((s) => {
    const o = evaluateDeclarative([live], s.facts, now);
    const got = o.denial ? "deny" : o.grants.length ? "grant" : "allow";
    return { name: s.name, expected: s.expect, got, ok: got === s.expect };
  });
}

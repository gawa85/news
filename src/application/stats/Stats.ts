import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type {
  BusinessKpis,
  DomainEvent,
  ObservatoryReport,
  Period,
  Plan,
  StatCounter,
  StatMetric,
  Subscription,
  UsagePanel,
  User,
} from "../../domain/model";
import type {
  IAnonymizer,
  IAuthorizationService,
  IEventBus,
  ILogger,
  INarrativeRepository,
  IPlanRepository,
  IParameterStore,
  IProductAnalytics,
  ITopicResolver,
  IStatsRepository,
  ISubscriptionRepository,
  IUserRepository,
  StatKey,
} from "../../domain/ports";

/** Día calendario en la zona del producto (Argentina, UTC-3 sin horario de verano). */
export function statDay(d: Date, offsetMinutes = -180): string {
  return new Date(d.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

export const statMonth = (d: Date, offsetMinutes = -180) => statDay(d, offsetMinutes).slice(0, 7);

/** Tema escrito por la gente → forma canónica (minúsculas, sin espacios de más). */
export const canonicalTopic = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);

/**
 * GRABADOR DE ESTADÍSTICAS: escucha los eventos del dominio y suma contadores diarios
 * por persona, por organización y globales. No guarda textos, sólo números y categorías.
 * Para lo global, además anota un SEUDÓNIMO por grupo y mes (así el observatorio puede
 * exigir un mínimo de personas distintas antes de publicar un número).
 */
export class StatsRecorder {
  constructor(
    private readonly stats: IStatsRepository,
    private readonly anonymizer: IAnonymizer,
    private readonly analytics: IProductAnalytics,
    private readonly logger: ILogger,
    private readonly params?: IParameterStore,
    /** Para contar por tema oficial ("gas" y "tarifas de gas" son lo mismo). */
    private readonly topics?: ITopicResolver,
  ) {}

  attach(bus: IEventBus): void {
    bus.subscribe(async (e) => {
      try {
        await this.handle(e);
      } catch (err) {
        // Las estadísticas nunca pueden romper la acción principal.
        this.logger.warn("No se pudo registrar la estadística", { event: e.type, error: String(err) });
      }
    });
  }

  private async handle(e: DomainEvent): Promise<void> {
    const day = statDay(e.occurredAt);
    const month = day.slice(0, 7);
    const who = this.anonymizer.pseudonym(e.userId);
    const scopes: Pick<StatKey, "scope" | "scopeId">[] = [{ scope: "user", scopeId: e.userId }, ...(e.organizationId ? [{ scope: "organization" as const, scopeId: e.organizationId }] : [])];
    const bump = async (metric: StatMetric, dim = "", opts: { personal?: boolean } = { personal: true }) => {
      if (opts.personal) for (const s of scopes) await this.stats.increment({ day, ...s, metric, dim });
      await this.stats.increment({ day, scope: "global", scopeId: "all", metric, dim });
      await this.stats.addContributor(`${month}|${metric}|${dim}`, who);
    };

    switch (e.type) {
      case "analysis.completed": {
        const types = (e.data.smokeTypes as string[] | undefined) ?? [];
        const hasSmoke = Number(e.data.smokeIndex ?? 0) >= (this.params ? await this.params.number("smoke.threshold") : 30);
        await bump("analyses");
        if (hasSmoke) await bump("analyses_with_smoke");
        for (const t of types) await bump("smoke_type", t);
        if (e.data.channel) await bump("channel", String(e.data.channel));
        if (e.data.sourceType) await bump("source_type", String(e.data.sourceType));
        // Activación: primer análisis de la historia de esta persona.
        const lifetime = await this.stats.increment({ day: "total", scope: "user", scopeId: e.userId, metric: "analyses" });
        if (lifetime === 1) {
          await bump("activations", "", { personal: false });
          await this.analytics.track("activated", who, { channel: String(e.data.channel ?? "") });
        }
        await this.analytics.track("analysis_completed", who, { channel: String(e.data.channel ?? ""), smoke: hasSmoke });
        return;
      }
      case "comparison.completed":
        await bump("comparisons");
        if (e.data.topic) {
          const t = String(e.data.topic);
          await bump("comparison_topic", (await this.topics?.resolve(t))?.name ?? canonicalTopic(t));
        }
        await this.analytics.track("comparison_completed", who, { sources: Number(e.data.sources ?? 0) });
        return;
      case "user.registered":
        await bump("registrations", String(e.data.channel ?? "web"), { personal: false });
        await this.analytics.track("signed_up", who, { channel: String(e.data.channel ?? "web") });
        return;
      case "payment.confirmed":
        await this.analytics.track("paid", who, { plan: String(e.data.planId ?? "") });
        return;
      default:
        return;
    }
  }
}

const MAX_PANEL_DAYS = 366;

/**
 * CONSULTAS DE ESTADÍSTICAS.
 *  - panel(): el uso propio o el de la organización (este último con `stats:org`).
 *  - observatory(): lo público, mensual, con k-anonimato y redondeo.
 *  - business(): MRR, bajas, conversión y activación (con `stats:business`).
 */
export class StatsService {
  constructor(
    private readonly stats: IStatsRepository,
    private readonly users: IUserRepository,
    private readonly subscriptions: ISubscriptionRepository,
    private readonly plans: IPlanRepository,
    private readonly narratives: INarrativeRepository,
    private readonly authz: IAuthorizationService,
    private readonly anonymizer: IAnonymizer,
  ) {}

  async panel(input: { actorId: string; scope: "user" | "organization"; period: Period }): Promise<UsagePanel> {
    const actor = await this.actor(input.actorId);
    const days = daysBetween(input.period);
    if (days.length > MAX_PANEL_DAYS) throw new ValidationError(`El período máximo es de ${MAX_PANEL_DAYS} días.`);
    let scopeId = actor.id;
    if (input.scope === "organization") {
      if (!actor.organizationId) throw new ValidationError("No pertenecés a ninguna organización.");
      if (!(await this.authz.permissionsOf(actor)).has("stats:org")) throw new AccessDeniedError("No tenés permiso para ver las estadísticas de la organización.", "no_permission");
      scopeId = actor.organizationId;
    }
    const rows = await this.stats.find({ scope: input.scope, scopeId, fromDay: days[0]!, toDay: days.at(-1)! });
    const sum = (m: StatMetric, day?: string) => rows.filter((r) => r.metric === m && (!day || r.day === day)).reduce((s, r) => s + r.value, 0);
    const analyses = sum("analyses");
    const withSmoke = sum("analyses_with_smoke");
    const panel: UsagePanel = {
      scope: input.scope,
      scopeId,
      period: input.period,
      totals: { analyses, withSmoke, smokeRate: analyses ? round2(withSmoke / analyses) : null, comparisons: sum("comparisons") },
      daily: days.map((day) => ({ day, analyses: sum("analyses", day), withSmoke: sum("analyses_with_smoke", day), comparisons: sum("comparisons", day) })),
      smokeTypes: byDim(rows, "smoke_type").map(([type, count]) => ({ type, count })),
      channels: byDim(rows, "channel").map(([channel, count]) => ({ channel, count })),
      topics: byDim(rows, "comparison_topic").slice(0, 20).map(([topic, count]) => ({ topic, count })),
    };
    if (input.scope === "organization") {
      let active = 0;
      for (const m of await this.users.findByOrganization(scopeId)) {
        const mine = await this.stats.find({ scope: "user", scopeId: m.id, metrics: ["analyses", "comparisons"], fromDay: days[0]!, toDay: days.at(-1)! });
        if (mine.some((r) => r.value > 0)) active++;
      }
      panel.activeMembers = active;
    }
    return panel;
  }

  /** Observatorio público de un mes ("AAAA-MM"). */
  async observatory(month: string): Promise<ObservatoryReport> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ValidationError("El mes tiene que tener la forma AAAA-MM.");
    const [y, m] = month.split("-").map(Number) as [number, number];
    const from = new Date(Date.UTC(y, m - 1, 1, 3));
    const to = new Date(Date.UTC(y, m, 1, 3) - 1);
    const rows = await this.stats.find({ scope: "global", scopeId: "all", fromDay: `${month}-01`, toDay: `${month}-31` });
    let suppressed = 0;
    const pub = async (metric: StatMetric, dim: string, count: number) => {
      const v = this.anonymizer.publish(count, await this.stats.contributors(`${month}|${metric}|${dim}`));
      if (v === null && count > 0) suppressed++;
      return v;
    };
    const group = async (metric: StatMetric) => {
      const out: { key: string; count: number }[] = [];
      for (const [key, count] of byDim(rows, metric)) {
        const v = await pub(metric, key, count);
        if (v !== null) out.push({ key, count: v });
      }
      return out.sort((a, b) => b.count - a.count);
    };
    const total = await pub("analyses", "", sumOf(rows, "analyses"));
    const smoky = await pub("analyses_with_smoke", "", sumOf(rows, "analyses_with_smoke"));
    const k = this.anonymizer.minGroupSize;
    const narratives = (await this.narratives.findTop(from, 50))
      .filter((n) => n.firstSeenAt <= to && n.occurrences >= k)
      .slice(0, 20)
      .map((n) => ({
        id: n.id, sample: n.sample, occurrences: Math.round(n.occurrences / this.anonymizer.rounding) * this.anonymizer.rounding,
        firstSeen: n.firstSeenAt, lastSeen: n.lastSeenAt, countered: n.campaignIds.length > 0,
      }));
    return {
      period: { from, to },
      minGroupSize: k,
      rounding: this.anonymizer.rounding,
      totals: { analyses: total ?? 0, smokeRate: total && smoky !== null ? round2(smoky / total) : null },
      smokeTypes: (await group("smoke_type")).map((x) => ({ type: x.key, count: x.count })),
      channels: (await group("channel")).map((x) => ({ channel: x.key, count: x.count })),
      topics: (await group("comparison_topic")).slice(0, 30).map((x) => ({ topic: x.key, count: x.count })),
      narratives,
      suppressedGroups: suppressed,
      methodology:
        `Sólo se publican grupos aportados por al menos ${k} personas distintas en el mes; los números se redondean de a ${this.anonymizer.rounding}. ` +
        "No se guarda ni publica el texto de los mensajes analizados (salvo las cadenas en circulación, con teléfonos y mails ocultos). " +
        "Refleja lo que la gente consultó, no todo lo que circula.",
    };
  }

  async business(input: { actorId: string; period: Period }): Promise<BusinessKpis> {
    const actor = await this.actor(input.actorId);
    if (!(await this.authz.permissionsOf(actor)).has("stats:business")) throw new AccessDeniedError("Sólo el equipo de la plataforma ve las métricas del negocio.", "no_permission");
    const { from, to } = input.period;
    const plans = new Map((await this.plans.findAll()).map((p) => [p.id, p]));
    const subs = await this.subscriptions.findAll();
    const currency = [...plans.values()].find((p) => p.price)?.price?.currency ?? "ARS";
    // Una moneda por reporte: los cobros en otras monedas (otros países) se informan aparte.
    const inCurrency = subs.filter((s) => !s.charged || s.charged.currency === currency);
    const atStart = paying(inCurrency, plans, from);
    const atEnd = paying(inCurrency, plans, to);
    const churned = [...atStart.keys()].filter((k) => !atEnd.has(k)).length;
    const newPaying = [...atEnd.keys()].filter((k) => !atStart.has(k)).length;
    const mrr = sumMrr(atEnd, plans);
    const counters = await this.stats.find({ scope: "global", scopeId: "all", metrics: ["registrations", "activations"], fromDay: statDay(from), toDay: statDay(to) });
    const registrations = sumOf(counters, "registrations");
    const activations = sumOf(counters, "activations");
    const byPlan = new Map<string, { planId: string; subjects: number; mrr: number }>();
    for (const s of atEnd.values()) {
      const e = byPlan.get(s.planId) ?? { planId: s.planId, subjects: 0, mrr: 0 };
      e.subjects++;
      e.mrr += monthlyOf(s, plans);
      byPlan.set(s.planId, e);
    }
    return {
      period: input.period,
      currency,
      mrr,
      mrrAtStart: sumMrr(atStart, plans),
      payingSubjects: atEnd.size,
      payingAtStart: atStart.size,
      newPaying,
      churned,
      churnRate: atStart.size ? round2(churned / atStart.size) : null,
      arpu: atEnd.size ? Math.round(mrr / atEnd.size) : null,
      registrations,
      activations,
      activationRate: registrations ? round2(Math.min(1, activations / registrations)) : null,
      conversionRate: registrations ? round2(Math.min(1, newPaying / registrations)) : null,
      trialing: subs.filter((s) => s.status === "trialing" && !s.endedAt && s.currentPeriodEnd > to).length,
      byPlan: [...byPlan.values()].sort((a, b) => b.mrr - a.mrr),
    };
  }

  private async actor(id: string): Promise<User> {
    const u = await this.users.findById(id);
    if (!u || u.status !== "active") throw new NotFoundError("Usuario inexistente.");
    return u;
  }
}

// ---------------- utilidades ----------------

const round2 = (n: number) => Math.round(n * 100) / 100;

function daysBetween(p: Period): string[] {
  if (p.to < p.from) throw new ValidationError("El período termina antes de empezar.");
  const out: string[] = [];
  const last = statDay(p.to);
  for (let t = p.from.getTime(); out.length <= MAX_PANEL_DAYS; t += 86_400_000) {
    const d = statDay(new Date(t));
    if (out.at(-1) !== d) out.push(d);
    if (d >= last) break;
  }
  return out;
}

function sumOf(rows: StatCounter[], metric: StatMetric): number {
  return rows.filter((r) => r.metric === metric).reduce((s, r) => s + r.value, 0);
}

function byDim(rows: StatCounter[], metric: StatMetric): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) if (r.metric === metric) m.set(r.dim, (m.get(r.dim) ?? 0) + r.value);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Precio mensual equivalente (los planes anuales se prorratean por 12). */
function monthly(plan: Plan | undefined): number {
  if (!plan?.price) return 0;
  return plan.price.interval === "year" ? Math.round(plan.price.amount / 12) : plan.price.amount;
}

/** Hasta cuándo valió una suscripción. */
function endOf(s: Subscription): number {
  if (s.endedAt) return s.endedAt.getTime();
  if (s.status === "canceled") return s.currentPeriodEnd.getTime();
  if (s.status === "replaced") return s.createdAt.getTime(); // datos viejos sin fecha de fin: no cuenta
  return Number.POSITIVE_INFINITY;
}

/** Quiénes pagaban en un momento dado (sujeto → la suscripción paga vigente). */
function paying(subs: Subscription[], plans: Map<string, Plan>, at: Date): Map<string, Subscription> {
  const out = new Map<string, Subscription>();
  for (const s of subs) {
    if (!plans.get(s.planId)?.price) continue;
    if (s.status === "pending_payment" || s.status === "trialing") continue;
    if (s.createdAt.getTime() > at.getTime() || endOf(s) <= at.getTime()) continue;
    const key = `${s.subject.type}:${s.subject.id}`;
    const prev = out.get(key);
    if (!prev || prev.createdAt < s.createdAt) out.set(key, s);
  }
  return out;
}

/** Ingreso mensual de una suscripción: lo cobrado (con cupón y período) o el precio del plan. */
function monthlyOf(s: Subscription, plans: Map<string, Plan>): number {
  if (s.charged) return (s.interval ?? "month") === "year" ? Math.round(s.charged.amount / 12) : s.charged.amount;
  return monthly(plans.get(s.planId));
}

function sumMrr(m: Map<string, Subscription>, plans: Map<string, Plan>): number {
  let t = 0;
  for (const s of m.values()) t += monthlyOf(s, plans);
  return t;
}

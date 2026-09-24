import type { AlertHit, AlertRule, ResponseContent } from "../../domain/model";
import type {
  IAlertEvaluator,
  IAlertRuleRepository,
  IArticleReader,
  IClock,
  IDomainEvents,
  ILogger,
  IOutletReader,
  IRequestContext,
  IUserRepository,
} from "../../domain/ports";
import { billingSubjectOf } from "../access/AccessControl";
import type { CompareSourcesUseCase } from "../CompareSourcesUseCase";
import type { EvaluateCredibilityUseCase } from "../EvaluateCredibilityUseCase";
import type { AccessControl } from "../access/AccessControl";
import type { NotificationService } from "../messaging/NotificationService";

// ------------------------------------------------------------------
// Evaluadores: uno por disparador (OCP).
// ------------------------------------------------------------------

/** "Hay notas nuevas sobre el tema." */
export class NewCoverageEvaluator implements IAlertEvaluator {
  readonly trigger = "new_coverage" as const;

  constructor(
    private readonly articles: IArticleReader,
    private readonly outlets: IOutletReader,
  ) {}

  async evaluate(rule: AlertRule, since: Date, now: Date) {
    const fresh = (await this.articles.find({ topic: rule.topic, period: { from: new Date(since.getTime() + 1), to: now } }));
    if (!fresh.length) return {};
    const outlets = await this.outlets.findAll();
    const name = (id: string) => outlets.find((o) => o.id === id)?.name ?? id;
    const hit: AlertHit = {
      title: `${fresh.length} nota(s) nueva(s) sobre "${rule.topic}"`,
      lines: fresh.slice(0, 5).map((a) => `${name(a.outletId)}: ${a.title}`),
      links: fresh.slice(0, 5).map((a) => ({ label: name(a.outletId), url: a.url })),
    };
    return { hit };
  }
}

/** "Apareció un dato en disputa." Recuerda qué desacuerdos ya avisó para no repetir. */
export class NewDisagreementEvaluator implements IAlertEvaluator {
  readonly trigger = "new_disagreement" as const;

  constructor(
    private readonly compare: CompareSourcesUseCase,
    private readonly lookbackDays = 30,
  ) {}

  async evaluate(rule: AlertRule, _since: Date, now: Date) {
    let comparison;
    try {
      comparison = await this.compare.execute({ topic: rule.topic, period: { from: new Date(now.getTime() - this.lookbackDays * 86_400_000), to: now } });
    } catch {
      return {}; // sin fuentes suficientes todavía
    }
    const seen = new Set((rule.lastState?.seen as string[] | undefined) ?? []);
    const signature = (d: { type: string; description: string }) => `${d.type}:${d.description}`;
    const fresh = comparison.disagreements.filter((d) => !seen.has(signature(d)));
    const state = { seen: [...seen, ...fresh.map(signature)].slice(-200) };
    if (!fresh.length) return { state };
    return {
      state,
      hit: {
        title: `Dato en disputa sobre "${rule.topic}"`,
        lines: fresh.slice(0, 3).map((d) => d.description),
        links: comparison.articleUrls.slice(0, 5).map((u) => ({ label: new URL(u).hostname.replace(/^www\./, ""), url: u })),
      },
    };
  }
}

/** "Cambió la credibilidad de un medio en el tema" (umbral configurable, en puntos de 0 a 1). */
export class CredibilityChangeEvaluator implements IAlertEvaluator {
  readonly trigger = "credibility_change" as const;

  constructor(
    private readonly credibility: EvaluateCredibilityUseCase,
    private readonly threshold = 0.1,
    private readonly windowDays = 180,
  ) {}

  async evaluate(rule: AlertRule, _since: Date, now: Date) {
    if (!rule.outletId) return {};
    const report = await this.credibility.evaluate({ outletId: rule.outletId, topic: rule.topic, period: { from: new Date(now.getTime() - this.windowDays * 86_400_000), to: now } });
    const previous = rule.lastState?.score as number | null | undefined;
    const state = { score: report.overall };
    if (report.overall === null || previous === undefined || previous === null) return { state };
    const delta = report.overall - previous;
    if (Math.abs(delta) < this.threshold) return { state };
    const pct = (n: number) => `${Math.round(n * 100)}/100`;
    return {
      state,
      hit: {
        title: `La credibilidad de ${report.outletName} en "${rule.topic}" ${delta > 0 ? "subió" : "bajó"}`,
        lines: [`Antes: ${pct(previous)} · Ahora: ${pct(report.overall)}`, ...report.dimensions.filter((d) => d.score !== null).map((d) => `${d.label}: ${pct(d.score!)}`)],
        links: [],
      },
    };
  }
}

// ------------------------------------------------------------------
// Caso de uso: evaluar todas las alertas activas (tarea periódica).
// ------------------------------------------------------------------

/**
 * REGLAS:
 *  - Si el plan del usuario ya no incluye alertas o el canal, la alerta no avisa
 *    (no se borra: vuelve a funcionar si mejora el plan).
 *  - En WhatsApp el aviso sale como PLANTILLA aprobada (puede estar fuera de la ventana de 24 h).
 *  - Un error en una alerta no frena las demás.
 */
export class EvaluateAlertsUseCase {
  constructor(
    private readonly alerts: IAlertRuleRepository,
    private readonly evaluators: IAlertEvaluator[],
    private readonly users: IUserRepository,
    private readonly access: AccessControl,
    private readonly notifications: NotificationService,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    private readonly whatsappTemplate = { name: "alerta_tema", language: "es_AR" },
    private readonly context?: IRequestContext,
  ) {}

  async execute(): Promise<{ ruleId: string; notified: boolean; reason?: string }[]> {
    const now = this.clock.now();
    const results = [];
    for (const rule of await this.alerts.findAllActive()) {
      try {
        results.push({ ruleId: rule.id, ...(await this.evaluateOne(rule, now)) });
      } catch (err) {
        this.logger.warn("Falló una alerta", { ruleId: rule.id, error: String(err) });
        results.push({ ruleId: rule.id, notified: false, reason: String(err) });
      }
    }
    return results;
  }

  private async evaluateOne(rule: AlertRule, now: Date): Promise<{ notified: boolean; reason?: string }> {
    const evaluator = this.evaluators.find((e) => e.trigger === rule.trigger);
    if (!evaluator) return { notified: false, reason: "sin evaluador" };
    const since = rule.lastCheckedAt ?? rule.createdAt;
    const { hit, state } = await evaluator.evaluate(rule, since, now);
    await this.alerts.save({ ...rule, lastCheckedAt: now, lastState: state ?? rule.lastState });
    if (!hit) return { notified: false };

    const user = await this.users.findById(rule.userId);
    if (!user || user.status !== "active") return { notified: false, reason: "usuario inactivo" };
    const { plan } = await this.access.planOf(user);
    if (!plan.features.includes("alerts") || !plan.channels.includes(rule.channel)) return { notified: false, reason: "el plan ya no lo incluye" };
    const address = user.channels.find((c) => c.channel === rule.channel && c.verified)?.address;
    if (!address) return { notified: false, reason: "canal no verificado" };

    const content: ResponseContent = { kind: "info", title: `🔔 ${hit.title}`, sections: [{ lines: hit.lines }], links: hit.links };
    const template = rule.channel === "whatsapp" ? { template: { ...this.whatsappTemplate, params: [rule.topic, hit.title] } } : {};
    const send = () => this.notifications.sendTo(rule.channel, address, content, "notification", template);
    const info = { userId: user.id, subjectId: billingSubjectOf(user).id, action: "alert" };
    const delivery = this.context ? await this.context.run(info, send) : await send();
    if (delivery.ok) {
      await this.events.emit("alert.triggered", { userId: user.id, organizationId: user.organizationId }, { topic: rule.topic, trigger: rule.trigger, title: hit.title }, { type: "alert", id: rule.id });
    }
    return { notified: delivery.ok, reason: delivery.error };
  }
}

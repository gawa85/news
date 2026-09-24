import { AccessDeniedError, ValidationError } from "../../domain/errors";
import {
  SMOKE_LABELS,
  type CredibilityQuery,
  type ExportDocument,
  type ExportFile,
  type ExportFormat,
  type ExportKind,
  type Period,
} from "../../domain/model";
import type { IAuthorizationService, IClock, IContentAnalysisRepository, IDomainEvents, IExporter, IOutletReader, NewsQuery } from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";
import type { Caller, ProductGateway } from "../access/ProductGateway";
import type { AuditQueryUseCase } from "../audit/Audit";
import type { ImpactReportUseCase } from "../impact/ImpactUseCases";
import type { StatsService } from "../stats/Stats";

export type ExportRequest =
  | { kind: "comparison"; query: NewsQuery }
  | { kind: "credibility"; query: CredibilityQuery }
  | { kind: "analysis_history"; limit?: number }
  | { kind: "impact"; period: Period }
  | { kind: "audit"; period: Period }
  | { kind: "usage_panel"; scope: "user" | "organization"; period: Period }
  | { kind: "business_kpis"; period: Period };

const pct = (n: number | null) => (n === null ? null : Math.round(n * 100));
const d = (x: Date) => x.toISOString().slice(0, 10);

/**
 * Exportar resultados. REGLAS: plan con `export`; además, cada tipo exige lo mismo
 * que verlo en pantalla (la comparación y la credibilidad pasan por el ProductGateway,
 * con sus permisos y cuotas; impacto y auditoría, sus permisos).
 */
export class ExportService {
  constructor(
    private readonly exporters: IExporter[],
    private readonly gateway: ProductGateway,
    private readonly access: AccessControl,
    private readonly authz: IAuthorizationService,
    private readonly analyses: IContentAnalysisRepository,
    private readonly impact: ImpactReportUseCase,
    private readonly auditQuery: AuditQueryUseCase,
    private readonly outlets: IOutletReader,
    private readonly events: IDomainEvents,
    private readonly clock: IClock,
    private readonly stats?: StatsService,
  ) {}

  async export(caller: Caller, req: ExportRequest, format: ExportFormat): Promise<ExportFile> {
    const exporter = this.exporters.find((e) => e.format === format);
    if (!exporter) throw new ValidationError(`Formato no soportado: ${format}.`);
    const user = await this.access.userOrThrow(caller.userId);
    const { plan } = await this.access.planOf(user);
    if (!plan.features.includes("export")) throw new AccessDeniedError(`Exportar no está incluido en el plan ${plan.name}.`, "feature_not_in_plan");

    const doc = await this.build(caller, req);
    const file = await exporter.render(doc, `sin-humo-${req.kind}-${d(this.clock.now())}`);
    await this.events.emit("export.generated", { userId: user.id, organizationId: user.organizationId }, { kind: req.kind, format });
    return file;
  }

  private requireStats(): StatsService {
    if (!this.stats) throw new ValidationError("Las estadísticas no están configuradas.");
    return this.stats;
  }

  private async build(caller: Caller, req: ExportRequest): Promise<ExportDocument> {
    const now = this.clock.now();
    const outlets = await this.outlets.findAll();
    const name = (id: string) => outlets.find((o) => o.id === id)?.name ?? id.replace(/^web:/, "");

    switch (req.kind) {
      case "comparison": {
        const c = await this.gateway.compareSources(caller, req.query);
        return {
          title: `Comparación de fuentes: ${c.topic}`,
          meta: [["Período", `${d(req.query.period.from)} a ${d(req.query.period.to)}`], ["Fuentes", c.outletIds.map(name).join(", ")]],
          tables: [
            {
              name: "Afirmaciones",
              columns: ["Estado", "Afirmación", "Fuentes"],
              rows: [
                ...c.agreements.map((x) => ["Coinciden todas", x.summary, x.outletIds.map(name).join(", ")]),
                ...c.partialAgreements.map((x) => ["Coinciden varias", x.summary, x.outletIds.map(name).join(", ")]),
                ...c.disagreements.flatMap((x) => x.positions.map((p) => [`Difieren (${x.type})`, p.claimText, name(p.outletId)])),
              ],
            },
            { name: "Notas usadas", columns: ["URL"], rows: c.articleUrls.map((u) => [u]) },
          ],
          notes: c.openQuestions,
          generatedAt: now,
        };
      }
      case "credibility": {
        const r = await this.gateway.evaluateCredibility(caller, req.query);
        return {
          title: `Credibilidad de ${r.outletName} en "${r.query.topic}"`,
          meta: [["Período", `${d(r.query.period.from)} a ${d(r.query.period.to)}`], ["Notas analizadas", String(r.sampleSize)], ["Resumen (0-100)", String(pct(r.overall) ?? "sin datos")]],
          tables: [
            { name: "Dimensiones", columns: ["Dimensión", "Puntaje (0-100)", "Confianza (%)", "Detalle"], rows: r.dimensions.map((x) => [x.label, pct(x.score), Math.round(x.confidence * 100), x.summary]) },
            { name: "Réplicas del medio", columns: ["Fecha", "Estado", "Réplica"], rows: r.rebuttals.map((x) => [d(x.createdAt), x.status, x.statement]) },
          ],
          notes: [r.disclaimer],
          generatedAt: now,
        };
      }
      case "analysis_history": {
        const items = await this.analyses.findByUser(caller.userId, Math.min(req.limit ?? 500, 5000));
        return {
          title: "Historial de análisis",
          meta: [["Cantidad", String(items.length)]],
          tables: [{
            name: "Análisis",
            columns: ["Fecha", "Origen", "Título", "Índice de humo", "Humo detectado", "Señales"],
            rows: items.map((a) => [
              a.analyzedAt.toISOString(), a.item.sourceType, a.item.title ?? "", a.smoke.smokeIndex,
              [...new Set(a.smoke.findings.map((f) => SMOKE_LABELS[f.type]))].join("; "),
              a.signals.map((s) => s.label).join("; "),
            ]),
          }],
          notes: [],
          generatedAt: now,
        };
      }
      case "impact": {
        const user = await this.access.userOrThrow(caller.userId);
        const perms = await this.authz.permissionsOf(user);
        if (!perms.has("replies:moderate") && !perms.has("audit:read")) throw new AccessDeniedError("No tenés acceso a los reportes de impacto.", "no_permission");
        const r = await this.impact.execute(req.period);
        const cols = ["Destino", "Publicadas", "Vistas", "Reacciones +", "Reacciones -", "Respuestas", "Clics", "Originales corregidos", "Eliminadas"];
        const row = (label: string, t: typeof r.totals) => [label, t.published, t.views, t.reactionsPositive, t.reactionsNegative, t.replies, t.clicks, t.originalsCorrected, t.repliesRemoved];
        return {
          title: "Impacto de las respuestas",
          meta: [["Período", `${d(req.period.from)} a ${d(req.period.to)}`], ["Tasa de corrección", String(r.correctionRate ?? "-")], ["Tasa de eliminación", String(r.removalRate ?? "-")]],
          tables: [
            { name: "Por destino", columns: cols, rows: [...r.byDestination.map((x) => row(x.destination, x)), row("TOTAL", r.totals)] },
            { name: "Por tema", columns: ["Tema", ...cols.slice(1)], rows: r.byTopic.map((x) => row(x.topic, x)) },
          ],
          notes: [],
          generatedAt: now,
        };
      }
      case "usage_panel": {
        const p = await this.requireStats().panel({ actorId: caller.userId, scope: req.scope, period: req.period });
        return {
          title: req.scope === "organization" ? "Uso de la organización" : "Tu uso de Sin Humo",
          meta: [
            ["Período", `${d(req.period.from)} a ${d(req.period.to)}`],
            ["Análisis", String(p.totals.analyses)],
            ["Con humo", `${p.totals.withSmoke} (${p.totals.smokeRate === null ? "-" : `${Math.round(p.totals.smokeRate * 100)}%`})`],
            ["Comparaciones", String(p.totals.comparisons)],
            ...(p.activeMembers !== undefined ? [["Miembros activos", String(p.activeMembers)] as [string, string]] : []),
          ],
          tables: [
            { name: "Por día", columns: ["Día", "Análisis", "Con humo", "Comparaciones"], rows: p.daily.map((x) => [x.day, x.analyses, x.withSmoke, x.comparisons]) },
            { name: "Tipos de humo", columns: ["Tipo", "Análisis"], rows: p.smokeTypes.map((x) => [SMOKE_LABELS[x.type as keyof typeof SMOKE_LABELS] ?? x.type, x.count]) },
            { name: "Canales", columns: ["Canal", "Análisis"], rows: p.channels.map((x) => [x.channel, x.count]) },
            { name: "Temas comparados", columns: ["Tema", "Veces"], rows: p.topics.map((x) => [x.topic, x.count]) },
          ],
          notes: [],
          generatedAt: now,
        };
      }
      case "business_kpis": {
        const k = await this.requireStats().business({ actorId: caller.userId, period: req.period });
        const pctOrDash = (n: number | null) => (n === null ? "-" : `${Math.round(n * 100)}%`);
        return {
          title: "Métricas del negocio",
          meta: [["Período", `${d(req.period.from)} a ${d(req.period.to)}`], ["Moneda", k.currency]],
          tables: [
            {
              name: "Indicadores",
              columns: ["Indicador", "Valor"],
              rows: [
                ["MRR al cierre", k.mrr], ["MRR al inicio", k.mrrAtStart], ["Clientes que pagan", k.payingSubjects], ["Nuevos clientes pagos", k.newPaying],
                ["Bajas", k.churned], ["Tasa de bajas", pctOrDash(k.churnRate)], ["Ingreso promedio por cliente", k.arpu], ["Registros", k.registrations],
                ["Activaciones (primer análisis)", k.activations], ["Tasa de activación", pctOrDash(k.activationRate)], ["Conversión a pago", pctOrDash(k.conversionRate)], ["En prueba", k.trialing],
              ],
            },
            { name: "Por plan", columns: ["Plan", "Clientes", "MRR"], rows: k.byPlan.map((x) => [x.planId, x.subjects, x.mrr]) },
          ],
          notes: ["MRR: planes anuales prorrateados por 12. Conversión: nuevos pagos sobre registros del período (aproximación)."],
          generatedAt: now,
        };
      }
      case "audit": {
        const entries = await this.auditQuery.execute({ actorId: caller.userId, filter: { from: req.period.from, to: req.period.to, limit: 10_000 } });
        return {
          title: "Auditoría",
          meta: [["Período", `${d(req.period.from)} a ${d(req.period.to)}`], ["Registros", String(entries.length)]],
          tables: [{ name: "Registros", columns: ["Fecha", "Acción", "Quién", "Sobre", "Detalle"], rows: entries.map((e) => [e.at.toISOString(), e.action, e.actorId, e.target ? `${e.target.type}:${e.target.id}` : "", JSON.stringify(e.data)]) }],
          notes: [],
          generatedAt: now,
        };
      }
    }
  }
}

export type { ExportKind };

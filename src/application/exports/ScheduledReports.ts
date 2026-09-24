import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { ExportFormat, Period, ReportKind, ReportSchedule, User } from "../../domain/model";
import type { IClock, IDomainEvents, IIdGenerator, ILogger, IParameterStore, IReportScheduleRepository, IUserRepository } from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";
import type { NotificationService } from "../messaging/NotificationService";
import type { ExportRequest, ExportService } from "./ExportService";

const MAX_RECIPIENTS = 10;
const MAX_SCHEDULES = 20;
/** Hora de envío: 8 de la mañana en Argentina (11 UTC). */
const SEND_HOUR_UTC = 11;

const KIND_LABEL: Record<ReportKind, string> = {
  usage_panel: "Uso",
  analysis_history: "Historial de análisis",
  impact: "Impacto de las respuestas",
  audit: "Auditoría",
  business_kpis: "Métricas del negocio",
};

/**
 * REPORTES PROGRAMADOS: un reporte que llega solo por mail (semanal o mensual), en el
 * formato que se elija (Excel, PDF, CSV, JSON).
 * REGLAS:
 *  - Plan con `scheduled_reports` (y `export`).
 *  - Sólo a mails VERIFICADOS de quien lo crea o de miembros de su organización
 *    (no se puede usar para mandarle cosas a desconocidos).
 *  - Al crearlo se genera una vez de prueba: si no tenés permiso para ese reporte, falla ahí.
 *  - Si después se pierde el permiso o el plan, el reporte se PAUSA (no se manda a medias).
 *  - Es un aviso: respeta la baja ("BAJA") y lleva el pie para darse de baja.
 */
export class ScheduledReportService {
  constructor(
    private readonly repo: IReportScheduleRepository,
    private readonly exports: ExportService,
    private readonly access: AccessControl,
    private readonly users: IUserRepository,
    private readonly notifications: NotificationService,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    private readonly params?: IParameterStore,
  ) {}

  async create(input: { actorId: string; name: string; kind: ReportKind; scope?: "user" | "organization"; format: ExportFormat; frequency: "weekly" | "monthly"; recipients: string[] }): Promise<ReportSchedule> {
    const actor = await this.access.userOrThrow(input.actorId);
    const { plan } = await this.access.planOf(actor);
    if (!plan.features.includes("scheduled_reports")) throw new AccessDeniedError(`Los reportes automáticos no están incluidos en el plan ${plan.name}.`, "feature_not_in_plan");
    if (!["weekly", "monthly"].includes(input.frequency)) throw new ValidationError("La frecuencia puede ser semanal o mensual.");
    const recipients = [...new Set(input.recipients.map((r) => r.trim().toLowerCase()))];
    const max = this.params ? await this.params.number("reports.max_recipients") : MAX_RECIPIENTS;
    if (!recipients.length || recipients.length > max) throw new ValidationError(`Indicá entre 1 y ${max} destinatarios.`);
    const allowed = await this.allowedRecipients(actor);
    const unknown = recipients.filter((r) => !allowed.has(r));
    if (unknown.length) throw new ValidationError(`Sólo se puede enviar a mails verificados tuyos o de tu organización. No verificados: ${unknown.join(", ")}.`);
    if ((await this.repo.findByOwner(actor.id)).length >= MAX_SCHEDULES) throw new ConflictError(`Podés tener hasta ${MAX_SCHEDULES} reportes programados.`);

    const draft: ReportSchedule = {
      id: this.ids.next("report"), ownerId: actor.id, organizationId: actor.organizationId, name: input.name.trim().slice(0, 100) || KIND_LABEL[input.kind],
      kind: input.kind, scope: input.scope, format: input.format, frequency: input.frequency, recipients, active: true,
      nextRunAt: nextRun(input.frequency, this.clock.now()), createdAt: this.clock.now(),
    };
    // Prueba en seco: valida permisos, plan y formato antes de guardar.
    await this.exports.export({ userId: actor.id, channel: "email" }, this.request(draft, this.clock.now()), draft.format);
    await this.repo.save(draft);
    return draft;
  }

  list(actorId: string): Promise<ReportSchedule[]> {
    return this.repo.findByOwner(actorId);
  }

  async remove(input: { actorId: string; id: string }): Promise<void> {
    const s = await this.repo.findById(input.id);
    if (!s || s.ownerId !== input.actorId) throw new NotFoundError("No existe ese reporte.");
    await this.repo.delete(s.id);
  }

  /** Lo corre un trabajo periódico: manda los reportes que vencieron. */
  async runDue(): Promise<{ sent: number; paused: number; failed: number }> {
    const now = this.clock.now();
    const result = { sent: 0, paused: 0, failed: 0 };
    for (const s of await this.repo.findDue(now)) {
      try {
        const owner = await this.users.findById(s.ownerId);
        if (!owner || owner.status !== "active") throw new AccessDeniedError("La cuenta que creó el reporte ya no está activa.", "no_permission");
        const file = await this.exports.export({ userId: s.ownerId, channel: "email" }, this.request(s, now), s.format);
        const allowed = await this.allowedRecipients(owner);
        let delivered = 0;
        for (const to of s.recipients.filter((r) => allowed.has(r))) {
          const r = await this.notifications.sendTo("email", to, {
            kind: "info",
            title: `${s.name} (${s.frequency === "weekly" ? "semanal" : "mensual"})`,
            summary: `Adjuntamos el reporte "${s.name}" en ${s.format.toUpperCase()}.`,
            sections: [{ lines: [`Lo programó ${owner.name}. Para dejar de recibirlo, respondé BAJA o pedíselo a quien lo creó.`] }],
            links: [],
          }, "notification", { subject: `Sin Humo · ${s.name}`, attachments: [{ filename: file.filename, contentType: file.contentType, content: file.data }] });
          if (r.ok) delivered++;
        }
        await this.repo.save({ ...s, lastRunAt: now, lastError: undefined, nextRunAt: nextRun(s.frequency, now) });
        await this.events.emit("report.sent", { userId: s.ownerId, organizationId: s.organizationId }, { kind: s.kind, format: s.format, recipients: delivered }, { type: "report", id: s.id });
        result.sent++;
      } catch (err) {
        if (err instanceof AccessDeniedError) {
          await this.repo.save({ ...s, active: false, lastError: err.message });
          result.paused++;
        } else {
          // Error transitorio: se reintenta en una hora.
          await this.repo.save({ ...s, lastError: err instanceof Error ? err.message : String(err), nextRunAt: new Date(now.getTime() + 3_600_000) });
          this.logger.warn("Falló un reporte programado", { id: s.id, error: String(err) });
          result.failed++;
        }
      }
    }
    return result;
  }

  private request(s: ReportSchedule, now: Date): ExportRequest {
    const period = previousPeriod(s.frequency, now);
    switch (s.kind) {
      case "usage_panel": return { kind: "usage_panel", scope: s.scope ?? "user", period };
      case "business_kpis": return { kind: "business_kpis", period };
      case "impact": return { kind: "impact", period };
      case "audit": return { kind: "audit", period };
      case "analysis_history": return { kind: "analysis_history", limit: 5000 };
    }
  }

  private async allowedRecipients(actor: User): Promise<Set<string>> {
    const people = actor.organizationId ? await this.users.findByOrganization(actor.organizationId) : [actor];
    return new Set(people.flatMap((u) => u.channels.filter((c) => c.channel === "email" && c.verified).map((c) => c.address.toLowerCase())));
  }
}

/** Próximo envío: lunes a las 8 (semanal) o el día 1 a las 8 (mensual), hora argentina. */
export function nextRun(frequency: "weekly" | "monthly", after: Date): Date {
  if (frequency === "monthly") {
    let d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), 1, SEND_HOUR_UTC));
    if (d <= after) d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, 1, SEND_HOUR_UTC));
    return d;
  }
  const d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), SEND_HOUR_UTC));
  const add = (8 - d.getUTCDay()) % 7; // 1 = lunes
  d.setUTCDate(d.getUTCDate() + add);
  if (d <= after) d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

/** Semana anterior (7 días hasta ahora) o mes calendario anterior. */
export function previousPeriod(frequency: "weekly" | "monthly", now: Date): Period {
  if (frequency === "weekly") return { from: new Date(now.getTime() - 7 * 86_400_000), to: now };
  const ar = new Date(now.getTime() - 3 * 3_600_000);
  const from = new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth() - 1, 1, 3));
  const to = new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), 1, 3) - 1);
  return { from, to };
}

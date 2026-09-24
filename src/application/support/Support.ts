import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { Ticket, TicketCategory, TicketPriority, TicketStatus, User } from "../../domain/model";
import type { IAuthorizationService, IClock, IDomainEvents, IIdGenerator, ILogger, IParameterStore, ISupportDesk, ITicketRepository, IUserRepository } from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";

/** Prioridad y tiempo de primera respuesta según el plan (el resto, parámetro). */
const SLA_BY_PLAN: Record<string, { priority: TicketPriority; hours: number }> = {
  empresa: { priority: "high", hours: 4 },
  equipo: { priority: "normal", hours: 12 },
  profesional: { priority: "normal", hours: 24 },
};

const ESCALATE: Record<TicketPriority, TicketPriority> = { low: "normal", normal: "high", high: "urgent", urgent: "urgent" };

/** Clasificación simple por palabras (el equipo la puede corregir). */
export function guessCategory(text: string): TicketCategory {
  const t = text.toLowerCase();
  if (/factura|cobr|pago|tarjeta|reintegro|cup[oó]n|precio/.test(t)) return "billing";
  if (/mis datos|borrar mi cuenta|eliminar mi cuenta|datos personales|25\.326/.test(t)) return "data_request";
  if (/r[eé]plica|difamaci|mi medio|evaluaci[oó]n de (mi|nuestro) medio/.test(t)) return "content_dispute";
  if (/error|no anda|no funciona|falla|bug|se cuelga/.test(t)) return "bug";
  if (/contraseñ|login|ingresar|cuenta|acceso/.test(t)) return "account";
  return "other";
}

export type Notify = (user: User, title: string, summary: string) => Promise<unknown>;

/**
 * SOPORTE CON TICKETS.
 * REGLAS:
 *  - Cualquiera abre un ticket (web, API o chat: "/soporte ..."). Ve sólo los suyos.
 *  - Prioridad y plazo de primera respuesta según el plan; las solicitudes sobre datos
 *    personales y los reclamos de medios suben de prioridad (plazos legales / riesgo).
 *  - Atienden quienes tienen `support:handle`. Las notas internas nunca se muestran.
 *  - Un trabajo periódico marca los vencidos y los escala.
 *  - Si hay una mesa de ayuda externa (Zendesk…), se le copia cada ticket.
 */
export class SupportService {
  constructor(
    private readonly repo: ITicketRepository,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly params: IParameterStore,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    private readonly notify?: Notify,
    private readonly external?: ISupportDesk,
  ) {}

  async open(input: { userId: string; text: string; subject?: string; category?: TicketCategory; channel: string }): Promise<Ticket> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new NotFoundError("Usuario inexistente.");
    const text = input.text.trim();
    if (text.length < 5) throw new ValidationError("Contanos un poco más (al menos una frase).");
    const recent = (await this.repo.findByRequester(user.id)).filter((t) => t.createdAt.getTime() > this.clock.now().getTime() - 3_600_000);
    if (recent.length >= 5) throw new ValidationError("Abriste muchos tickets en la última hora. Respondé en uno de los abiertos.");
    const category = input.category ?? guessCategory(text);
    const { plan } = await this.access.planOf(user);
    const sla = SLA_BY_PLAN[plan.id] ?? { priority: "low" as TicketPriority, hours: await this.params.number("support.first_response_hours_default") };
    // Plazos legales (datos personales) y riesgo reputacional (reclamo de un medio): prioridad alta.
    const priority: TicketPriority = category === "data_request" || category === "content_dispute" ? ESCALATE[sla.priority === "low" ? "normal" : sla.priority] : sla.priority;
    const now = this.clock.now();
    const id = `T-${this.ids.next("t").replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
    const t: Ticket = {
      id, requesterId: user.id, organizationId: user.organizationId, subject: (input.subject ?? text).slice(0, 80), category, priority, status: "open",
      channel: input.channel, messages: [{ id: `${id}-1`, authorId: user.id, role: "requester", text: text.slice(0, 5000), internal: false, at: now }],
      firstResponseDueAt: new Date(now.getTime() + sla.hours * 3_600_000), slaBreached: false, createdAt: now, updatedAt: now,
    };
    await this.repo.save(t);
    await this.mirror(t);
    await this.events.emit("support.ticket_created", { userId: user.id, organizationId: user.organizationId }, { ticket: id, category, priority }, { type: "ticket", id });
    return t;
  }

  /** La persona agrega un mensaje a su ticket (reabre si estaba resuelto). */
  async addFromRequester(input: { userId: string; ticketId: string; text: string }): Promise<Ticket> {
    const t = await this.mine(input.userId, input.ticketId);
    if (t.status === "closed") throw new ValidationError("Ese ticket está cerrado: abrí uno nuevo.");
    const next: Ticket = { ...t, status: "open", updatedAt: this.clock.now(), messages: [...t.messages, this.msg(t, input.userId, "requester", input.text, false)] };
    await this.repo.save(next);
    await this.mirror(next);
    return next;
  }

  async reply(input: { agentId: string; ticketId: string; text: string; internal?: boolean; status?: TicketStatus }): Promise<Ticket> {
    const agent = await this.agent(input.agentId);
    const t = await this.repo.findById(input.ticketId);
    if (!t) throw new NotFoundError("No existe ese ticket.");
    const now = this.clock.now();
    const internal = input.internal ?? false;
    const next: Ticket = {
      ...t, assigneeId: t.assigneeId ?? agent.id, updatedAt: now,
      status: input.status ?? (internal ? t.status : "pending"),
      firstRespondedAt: t.firstRespondedAt ?? (internal ? undefined : now),
      messages: [...t.messages, this.msg(t, agent.id, "agent", input.text, internal)],
    };
    await this.repo.save(next);
    await this.mirror(next);
    await this.events.emit("support.ticket_updated", { userId: agent.id }, { ticket: t.id, status: next.status, internal }, { type: "ticket", id: t.id });
    if (!internal) {
      const requester = await this.users.findById(t.requesterId);
      if (requester?.status === "active") await this.notify?.(requester, `Soporte · ${t.id}`, input.text.slice(0, 900));
    }
    return next;
  }

  /** Lo que ve la persona: sus tickets, sin notas internas. */
  async listMine(userId: string): Promise<Ticket[]> {
    return (await this.repo.findByRequester(userId)).map((t) => ({ ...t, messages: t.messages.filter((m) => !m.internal) }));
  }

  async latestOpen(userId: string): Promise<Ticket | undefined> {
    return (await this.repo.findByRequester(userId)).find((t) => t.status === "open" || t.status === "pending");
  }

  async queue(agentId: string): Promise<Ticket[]> {
    await this.agent(agentId);
    const order: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    return (await this.repo.findOpen()).sort((a, b) => order[a.priority] - order[b.priority] || a.firstResponseDueAt.getTime() - b.firstResponseDueAt.getTime());
  }

  async rate(input: { userId: string; ticketId: string; score: number }): Promise<void> {
    const t = await this.mine(input.userId, input.ticketId);
    if (t.status !== "solved" && t.status !== "closed") throw new ValidationError("Se califica cuando el ticket está resuelto.");
    if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) throw new ValidationError("La calificación va de 1 a 5.");
    await this.repo.save({ ...t, satisfaction: input.score, updatedAt: this.clock.now() });
  }

  /** Trabajo periódico: vencidos sin primera respuesta → se marcan y suben de prioridad. */
  async checkSla(): Promise<number> {
    const now = this.clock.now();
    let breached = 0;
    for (const t of await this.repo.findOpen()) {
      if (t.firstRespondedAt || t.slaBreached || t.firstResponseDueAt > now) continue;
      await this.repo.save({ ...t, slaBreached: true, priority: ESCALATE[t.priority], updatedAt: now });
      await this.events.emit("support.ticket_updated", { userId: "sistema:soporte" }, { ticket: t.id, slaBreached: true }, { type: "ticket", id: t.id });
      breached++;
    }
    return breached;
  }

  private msg(t: Ticket, authorId: string, role: "requester" | "agent", text: string, internal: boolean) {
    const clean = text.trim();
    if (!clean) throw new ValidationError("El mensaje está vacío.");
    return { id: `${t.id}-${t.messages.length + 1}`, authorId, role, text: clean.slice(0, 5000), internal, at: this.clock.now() };
  }

  private async mine(userId: string, ticketId: string): Promise<Ticket> {
    const t = await this.repo.findById(ticketId);
    if (!t || t.requesterId !== userId) throw new NotFoundError("No existe ese ticket.");
    return t;
  }

  private async agent(id: string): Promise<User> {
    const u = await this.users.findById(id);
    if (!u || !(await this.authz.permissionsOf(u)).has("support:handle")) throw new AccessDeniedError("No atendés soporte.", "no_permission");
    return u;
  }

  private async mirror(t: Ticket): Promise<void> {
    if (!this.external) return;
    try {
      const r = await this.external.push({ ...t, messages: t.messages });
      if (r.externalId && r.externalId !== t.externalId) await this.repo.save({ ...t, externalId: r.externalId });
    } catch (err) {
      this.logger.warn("No se pudo copiar el ticket a la mesa de ayuda externa", { ticket: t.id, error: String(err) });
    }
  }
}

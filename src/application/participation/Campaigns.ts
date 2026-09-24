import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import type { Campaign, CampaignPiece, CampaignReport, ResponseContent, User } from "../../domain/model";
import type {
  IAssetGenerator,
  IAuthorizationService,
  ICampaignChannel,
  ICampaignRepository,
  IClock,
  IDomainEvents,
  IIdGenerator,
  INarrativeRepository,
  IOrganizationRepository,
  IReviewModerator,
  ITrackedLinkRepository,
  IUserRepository,
} from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";
import type { NotificationService } from "../messaging/NotificationService";
import type { TrackedLinkService } from "../replies/ReplyService";
import { isoWeek } from "./Narratives";

/** Períodos en que no se permiten campañas de contenido político (veda electoral), por región. */
export interface ElectoralBlackout {
  region: string;
  from: Date;
  to: Date;
  description: string;
}

/**
 * CAMPAÑAS PARA CONTRARRESTAR EL HUMO.
 *
 * REGLAS (una herramienta de campañas no puede volverse lo que combate):
 *  - Permiso `campaigns:manage` + plan con `campaigns`.
 *  - Se contrarresta una AFIRMACIÓN; el mensaje cita al menos una fuente.
 *  - Quien emite queda identificado en CADA pieza ("Campaña de …").
 *  - La aprueba otra persona con `campaigns:review` (cuatro ojos); pasa moderación de lenguaje.
 *  - Sólo canales propios y audiencias que aceptaron (seguidores del tema, canal propio,
 *    aliados que dijeron que sí). No hay envío a desconocidos ni cuentas falsas.
 *  - Contenido político: no se lanza durante una veda electoral de la región.
 *  - Todo pasa además por las reglas de cumplimiento de cada canal (frecuencia, bajas).
 */
export class CampaignService {
  constructor(
    private readonly campaigns: ICampaignRepository,
    private readonly narratives: INarrativeRepository,
    private readonly channels: ICampaignChannel[],
    private readonly assets: IAssetGenerator,
    private readonly moderator: IReviewModerator,
    private readonly links: TrackedLinkService,
    private readonly trackedLinks: ITrackedLinkRepository,
    private readonly notifications: NotificationService,
    private readonly users: IUserRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly events: IDomainEvents,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
    private readonly orgs: IOrganizationRepository,
    private readonly blackouts: ElectoralBlackout[] = [],
    private readonly region = "AR",
  ) {}

  async create(input: { actorId: string; claim: string; message: ResponseContent; channelIds: string[]; narrativeId?: string; topic?: string; political: boolean }): Promise<Campaign> {
    const actor = await this.actor(input.actorId, "campaigns:manage");
    const { plan } = await this.access.planOf(actor);
    if (!plan.features.includes("campaigns")) throw new AccessDeniedError(`Las campañas no están en el plan ${plan.name}.`, "feature_not_in_plan");
    if (input.claim.trim().length < 15) throw new ValidationError("Describí la afirmación que querés contrarrestar.");
    if (input.message.links.length === 0) throw new ValidationError("La campaña tiene que citar al menos una fuente.");
    const unknown = input.channelIds.filter((id) => !this.channels.some((c) => c.id === id));
    if (unknown.length || input.channelIds.length === 0) throw new ValidationError(`Canales inválidos: ${unknown.join(", ") || "(ninguno)"}`);
    if (input.narrativeId && !(await this.narratives.findById(input.narrativeId))) throw new NotFoundError("No existe esa narrativa.");

    const verdict = await this.moderator.moderate(`${input.claim} ${input.message.title} ${input.message.summary ?? ""}`);
    if (verdict.verdict === "reject") throw new ValidationError(`El texto no pasa la moderación: ${verdict.reason}.`);

    const org = actor.organizationId ? await this.orgs.findById(actor.organizationId) : undefined;
    const sponsor = org?.name ?? actor.name;
    const id = this.ids.next("campaign");
    const message = await this.links.wrap(`campaign:${id}`, input.message);
    const campaign: Campaign = {
      id, ownerId: actor.id, organizationId: actor.organizationId, sponsor,
      narrativeId: input.narrativeId, claim: input.claim.trim(), message,
      pieces: await this.buildPieces(message, sponsor), channelIds: input.channelIds,
      topic: input.topic, political: input.political, status: "pending_review", createdAt: this.clock.now(),
      ...(verdict.verdict === "review" && verdict.reason ? { riskNotes: [verdict.reason] } : {}),
    };
    await this.campaigns.save(campaign);
    return campaign;
  }

  async review(input: { actorId: string; campaignId: string; approve: boolean; note: string; political?: boolean }): Promise<Campaign> {
    const actor = await this.actor(input.actorId, "campaigns:review");
    const c = await this.campaign(input.campaignId);
    if (c.status !== "pending_review") throw new ConflictError(`La campaña está ${c.status}.`);
    if (c.ownerId === actor.id) throw new AccessDeniedError("La campaña la tiene que aprobar otra persona.", "no_permission");
    if (c.organizationId && c.organizationId !== actor.organizationId && !(await this.authz.permissionsOf(actor)).has("users:manage_all")) {
      throw new AccessDeniedError("Sólo podés revisar campañas de tu organización.", "no_permission");
    }
    if (input.note.trim().length < 10) throw new ValidationError("Dejá una nota de revisión.");
    const next: Campaign = { ...c, status: input.approve ? "approved" : "rejected", reviewedBy: actor.id, reviewNote: input.note.trim(), political: input.political ?? c.political };
    await this.campaigns.save(next);
    await this.events.emit("campaign.reviewed", { userId: actor.id, organizationId: actor.organizationId }, { approved: input.approve }, { type: "campaign", id: c.id });
    return next;
  }

  async launch(input: { actorId: string; campaignId: string }): Promise<Campaign> {
    const actor = await this.actor(input.actorId, "campaigns:manage");
    const c = await this.campaign(input.campaignId);
    if (c.status !== "approved") throw new ConflictError("Sólo se lanza una campaña aprobada.");
    const now = this.clock.now();
    const blackout = this.blackouts.find((b) => b.region === this.region && b.from <= now && now <= b.to);
    if (c.political && blackout) throw new AccessDeniedError(`Veda electoral vigente (${blackout.description}): no se difunde contenido político.`, "no_permission");

    for (const channelId of c.channelIds) {
      const channel = this.channels.find((x) => x.id === channelId)!;
      for (const [i, piece] of c.pieces.entries()) {
        if (!channel.accepts.includes(piece.kind)) continue;
        const r = await channel.publish(c, piece, i);
        await this.campaigns.recordDelivery({ id: this.ids.next("cdel"), campaignId: c.id, channelId, pieceIndex: i, ok: r.ok, reach: r.reach, externalId: r.externalId, error: r.error, at: now });
      }
    }
    const running: Campaign = { ...c, status: "running", launchedAt: now };
    await this.campaigns.save(running);
    if (c.narrativeId) {
      const n = await this.narratives.findById(c.narrativeId);
      if (n) await this.narratives.save({ ...n, status: "countered", campaignIds: [...new Set([...n.campaignIds, c.id])] });
    }
    await this.events.emit("campaign.launched", { userId: actor.id, organizationId: actor.organizationId }, { claim: c.claim, channels: c.channelIds }, { type: "campaign", id: c.id });
    return running;
  }

  /** Invitar aliados: reciben la invitación y deciden. Sólo a quien acepta se le mandan las piezas. */
  async inviteAllies(input: { actorId: string; campaignId: string; userIds: string[] }): Promise<number> {
    const actor = await this.actor(input.actorId, "campaigns:manage");
    const c = await this.campaign(input.campaignId);
    let invited = 0;
    for (const userId of input.userIds) {
      const u = await this.users.findById(userId);
      if (!u || u.status !== "active") continue;
      if (c.organizationId && u.organizationId !== c.organizationId && u.organizationId) continue;
      await this.campaigns.saveAlly({ id: `${c.id}:${userId}`, campaignId: c.id, userId, status: "invited", invitedAt: this.clock.now() });
      await this.notifications.notifyUser(u, {
        kind: "info",
        title: `Invitación a sumarte a una campaña de ${c.sponsor}`,
        summary: `Contrarresta: "${c.claim}". Si aceptás, te mandamos las piezas para que decidas si las compartís desde tu cuenta. Podés aceptar o rechazar desde la web o la app (campaña ${c.id}).`,
        sections: [],
        links: [],
      }, ["web", "whatsapp", "telegram", "email"], { name: "campana_invitacion", language: "es_AR", params: [c.sponsor, c.claim] });
      invited++;
    }
    void actor;
    return invited;
  }

  async respondAlly(input: { userId: string; campaignId: string; accept: boolean }): Promise<void> {
    const c = await this.campaign(input.campaignId);
    const ally = (await this.campaigns.findAllies(c.id)).find((a) => a.userId === input.userId);
    if (!ally) throw new NotFoundError("No tenés una invitación a esa campaña.");
    await this.campaigns.saveAlly({ ...ally, status: input.accept ? "accepted" : "declined", respondedAt: this.clock.now() });
    if (!input.accept || c.status !== "running") return;
    const user = (await this.users.findById(input.userId))!;
    // Links propios por aliado: se mide cuánto rinde cada uno, sin datos de quien hace clic.
    const kit = await this.links.wrap(`campaign:${c.id}:ally:${user.id}`, c.message);
    await this.notifications.notifyUser(
      user,
      { ...kit, title: `Para compartir: ${kit.title}`, footer: `Campaña de ${c.sponsor}. Compartilo sólo si estás de acuerdo.` },
      ["web", "whatsapp", "telegram", "email"],
      { name: "campana_kit", language: "es_AR", params: [c.sponsor, kit.title, kit.links[0]?.url ?? ""] },
    );
  }

  async report(campaignId: string): Promise<CampaignReport> {
    const c = await this.campaign(campaignId);
    const deliveries = await this.campaigns.findDeliveries(c.id);
    const allies = await this.campaigns.findAllies(c.id);
    let clicks = 0;
    const clicksByAlly: Record<string, number> = {};
    const count = async (ref: string) => (await this.trackedLinks.findByReply(ref)).reduce((s, l) => s + l.clicks, 0);
    clicks += await count(`campaign:${c.id}`);
    for (const a of allies.filter((x) => x.status === "accepted")) {
      const n = await count(`campaign:${c.id}:ally:${a.userId}`);
      clicksByAlly[a.userId] = n;
      clicks += n;
    }
    let narrative: CampaignReport["narrative"];
    if (c.narrativeId && c.launchedAt) {
      const n = await this.narratives.findById(c.narrativeId);
      if (n) {
        const launchWeek = isoWeek(c.launchedAt);
        const weeks = Object.entries(n.weekly);
        const before = weeks.filter(([w]) => w < launchWeek).map(([, v]) => v);
        const after = weeks.filter(([w]) => w > launchWeek).map(([, v]) => v);
        const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
        const b = avg(before);
        const a = avg(after);
        narrative = { weeklyBefore: b, weeklyAfter: a, change: b > 0 && after.length ? Math.round(((a - b) / b) * 100) / 100 : null };
      }
    }
    return {
      campaignId: c.id,
      deliveries: deliveries.filter((d) => d.ok).length,
      reach: deliveries.reduce((s, d) => s + (d.ok ? d.reach : 0), 0),
      clicks,
      alliesAccepted: allies.filter((a) => a.status === "accepted").length,
      clicksByAlly,
      narrative,
    };
  }

  private async buildPieces(m: ResponseContent, sponsor: string): Promise<CampaignPiece[]> {
    const footer = `Campaña de ${sponsor} · Fuentes: ${m.links.map((l) => l.url).join(" ")}`;
    const body = m.summary ?? m.sections.flatMap((s) => s.lines).join(" ");
    return [
      { kind: "short_text", title: m.title, text: `${m.title}\n\n${body}\n\n${footer}` },
      { kind: "card", title: m.title, text: `${body}\n${footer}`, image: await this.assets.card({ title: m.title, body, footer: `Campaña de ${sponsor}` }) },
    ];
  }

  private async actor(id: string, perm: "campaigns:manage" | "campaigns:review"): Promise<User> {
    const u = await this.users.findById(id);
    if (!u || !(await this.authz.permissionsOf(u)).has(perm)) throw new AccessDeniedError("Tu rol no permite esta acción sobre campañas.", "no_permission");
    return u;
  }

  private async campaign(id: string): Promise<Campaign> {
    const c = await this.campaigns.findById(id);
    if (!c) throw new NotFoundError("No existe esa campaña.");
    return c;
  }
}

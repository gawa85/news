import { randomBytes } from "node:crypto";
import { AccessDeniedError, ConflictError, NotFoundError, ValidationError } from "../../domain/errors";
import {
  visibilityOf,
  type ReplyDraft,
  type ReplyTarget,
  type ResponseContent,
} from "../../domain/model";
import type {
  IAuthorizationService,
  IClock,
  IEventBus,
  IIdGenerator,
  IReplyDraftRepository,
  IReplyPublisher,
  ITrackedLinkRepository,
} from "../../domain/ports";
import type { AccessControl } from "../access/AccessControl";

/**
 * Links de seguimiento propios: la respuesta publicada lleva `https://…/r/abc123`,
 * que redirige al destino real y suma 1 clic. No se guarda nada de quien hace clic.
 */
export class TrackedLinkService {
  constructor(
    private readonly links: ITrackedLinkRepository,
    private readonly baseUrl: string,
    private readonly clock: IClock,
  ) {}

  async wrap(replyId: string, content: ResponseContent): Promise<ResponseContent> {
    const links = await Promise.all(
      content.links.map(async (l) => {
        if (!/^https?:\/\//.test(l.url)) return l;
        const code = randomBytes(5).toString("base64url");
        await this.links.save({ code, replyId, url: l.url, clicks: 0, createdAt: this.clock.now() });
        return { ...l, url: `${this.baseUrl}/r/${code}` };
      }),
    );
    return { ...content, links };
  }

  /** Lo llama el endpoint /r/:code. Devuelve a dónde redirigir. */
  async resolve(code: string): Promise<string | undefined> {
    const link = await this.links.findByCode(code);
    if (!link) return undefined;
    await this.links.save({ ...link, clicks: link.clicks + 1 });
    return link.url;
  }
}

/**
 * RESPONDER en cualquier destino: hilo de mail, chat, foro, página.
 *
 * REGLAS DE NEGOCIO:
 *  - Privada (al que preguntó, por mail o chat): permiso `replies:private`. Se publica ya.
 *  - Pública (foro, página): permiso `replies:publish_public` + plan con `public_replies`,
 *    y DEBE citar al menos una fuente (link). Nada de opiniones sin respaldo en público.
 *  - Pública sin permiso de moderación → queda "pendiente de revisión" hasta que alguien
 *    con `replies:moderate` la apruebe. Quien modera no puede aprobar lo que pidió otro
 *    de otra organización.
 *  - La identificación como bot y los límites de frecuencia los agrega la capa de
 *    cumplimiento (CompliantReplyPublisher).
 */
export class ReplyService {
  constructor(
    private readonly publishers: IReplyPublisher[],
    private readonly drafts: IReplyDraftRepository,
    private readonly authz: IAuthorizationService,
    private readonly access: AccessControl,
    private readonly links: TrackedLinkService,
    private readonly events: IEventBus,
    private readonly ids: IIdGenerator,
    private readonly clock: IClock,
  ) {}

  async request(input: { actorId: string; target: ReplyTarget; content: ResponseContent; topic?: string }): Promise<ReplyDraft> {
    const actor = await this.access.userOrThrow(input.actorId);
    const perms = await this.authz.permissionsOf(actor);
    const visibility = visibilityOf(input.target);

    if (visibility === "private" && !perms.has("replies:private")) {
      throw new AccessDeniedError("Tu rol no permite enviar respuestas.", "no_permission");
    }
    if (visibility === "public") {
      if (!perms.has("replies:publish_public")) throw new AccessDeniedError("Tu rol no permite publicar respuestas públicas.", "no_permission");
      const { plan } = await this.access.planOf(actor);
      if (!plan.features.includes("public_replies")) throw new AccessDeniedError(`Publicar en foros y páginas no está en el plan ${plan.name}.`, "feature_not_in_plan");
      if (input.content.links.length === 0) throw new ValidationError("Una respuesta pública tiene que citar al menos una fuente.");
    }
    if (!this.publishers.some((p) => p.supports(input.target))) {
      throw new ValidationError(`No hay una integración configurada para ${input.target.destination}.`);
    }

    const id = this.ids.next("reply");
    const draft: ReplyDraft = {
      id,
      requestedBy: actor.id,
      target: input.target,
      content: await this.links.wrap(id, input.content),
      visibility,
      status: "pending_review",
      topic: input.topic,
      createdAt: this.clock.now(),
    };

    if (visibility === "public" && !perms.has("replies:moderate")) {
      await this.drafts.save(draft);
      await this.emit("reply.pending_review", actor.id, actor.organizationId, { replyId: id, destination: draft.target.destination });
      return draft;
    }
    return this.publish(draft);
  }

  async review(input: { moderatorId: string; draftId: string; approve: boolean }): Promise<ReplyDraft> {
    const moderator = await this.access.userOrThrow(input.moderatorId);
    const perms = await this.authz.permissionsOf(moderator);
    if (!perms.has("replies:moderate")) throw new AccessDeniedError("No tenés permiso para moderar respuestas.", "no_permission");
    const draft = await this.drafts.findById(input.draftId);
    if (!draft) throw new NotFoundError("No existe esa respuesta.");
    if (draft.status !== "pending_review") throw new ConflictError(`La respuesta ya está ${draft.status}.`);
    const requester = await this.access.userOrThrow(draft.requestedBy);
    if (!perms.has("users:manage_all") && requester.organizationId !== moderator.organizationId) {
      throw new AccessDeniedError("Sólo podés moderar respuestas de tu organización.", "no_permission");
    }

    const reviewed = { ...draft, reviewedBy: moderator.id };
    await this.emit("reply.reviewed", moderator.id, moderator.organizationId, { replyId: draft.id, approved: input.approve });
    if (!input.approve) {
      const rejected: ReplyDraft = { ...reviewed, status: "rejected" };
      await this.drafts.save(rejected);
      return rejected;
    }
    return this.publish(reviewed);
  }

  private async publish(draft: ReplyDraft): Promise<ReplyDraft> {
    const publisher = this.publishers.find((p) => p.supports(draft.target))!;
    const result = await publisher.publish(draft.target, draft.content);
    const done: ReplyDraft = result.ok
      ? { ...draft, status: "published", publishedAt: this.clock.now(), publishedUrl: result.url, externalId: result.externalId, error: undefined }
      : { ...draft, status: "failed", error: result.error };
    await this.drafts.save(done);
    if (result.ok) {
      const requester = await this.access.userOrThrow(draft.requestedBy);
      await this.emit("reply.published", requester.id, requester.organizationId, { replyId: draft.id, destination: draft.target.destination, url: done.publishedUrl });
    }
    return done;
  }

  private emit(type: "reply.pending_review" | "reply.published" | "reply.reviewed", userId: string, organizationId: string | undefined, data: Record<string, unknown>) {
    return this.events.publish({ id: this.ids.next("evt"), type, userId, organizationId, occurredAt: this.clock.now(), data });
  }
}

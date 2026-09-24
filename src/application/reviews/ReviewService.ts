import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import {
  reviewSourceLabel,
  type RatingSummary,
  type Review,
  type ReviewTarget,
} from "../../domain/model";
import type {
  IClock,
  IReplyDraftRepository,
  IReviewModerator,
  IReviewRepository,
  IReviewSource,
  IUserRepository,
} from "../../domain/ports";

/**
 * CALIFICACIONES Y RESEÑAS.
 *
 * REGLAS:
 *  - Sólo usuarios activos con al menos un canal verificado pueden calificar.
 *  - Una calificación por usuario y objeto: volver a calificar la EDITA (id determinístico).
 *  - No se califica lo propio (una respuesta que uno mismo pidió publicar).
 *  - El texto pasa por moderación: aprobado, rechazado o a revisión humana.
 *  - Las reseñas externas sólo se LEEN de su plataforma y se muestran con su origen.
 *    Nunca se publican reseñas a nombre de nadie.
 */
export class ReviewService {
  constructor(
    private readonly reviews: IReviewRepository,
    private readonly users: IUserRepository,
    private readonly drafts: IReplyDraftRepository,
    private readonly moderator: IReviewModerator,
    private readonly sources: IReviewSource[],
    private readonly clock: IClock,
  ) {}

  async submit(input: { userId: string; target: ReviewTarget; rating: number | null; text?: string }): Promise<Review> {
    const user = await this.users.findById(input.userId);
    if (!user) throw new NotFoundError("Usuario inexistente.");
    if (user.status !== "active" || !user.channels.some((c) => c.verified)) {
      throw new AccessDeniedError("Para calificar necesitás una cuenta activa con un canal verificado.", "no_permission");
    }
    if (input.rating !== null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5)) {
      throw new ValidationError("La calificación va de 1 a 5.");
    }
    if (input.rating === null && !input.text?.trim()) throw new ValidationError("Poné una calificación o un comentario.");
    if (input.target.type === "reply") {
      const draft = await this.drafts.findById(input.target.id);
      if (draft?.requestedBy === user.id) throw new ValidationError("No podés calificar una respuesta que pediste vos.");
    }

    const verdict = input.text?.trim() ? await this.moderator.moderate(input.text) : { verdict: "approve" as const };
    const id = `internal:${input.target.type}:${input.target.id}:${user.id}`;
    const now = this.clock.now();
    const existing = await this.reviews.findById(id);
    const review: Review = {
      id,
      target: input.target,
      origin: { kind: "internal", userId: user.id },
      rating: input.rating,
      text: input.text?.trim() || undefined,
      status: verdict.verdict === "approve" ? "published" : verdict.verdict === "reject" ? "rejected" : "pending_moderation",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.reviews.save(review);
    return review;
  }

  /** Trae reseñas de otra plataforma y las asocia a un objeto (normalmente "platform"). */
  async importExternal(input: { platform: string; config: Record<string, string>; target: ReviewTarget; cursor?: string }): Promise<{ imported: number; cursor?: string }> {
    const source = this.sources.find((s) => s.platform === input.platform);
    if (!source) throw new ValidationError(`No hay integración de reseñas para ${input.platform}.`);
    const { reviews, cursor } = await source.pull(input.config, input.cursor);
    const now = this.clock.now();
    for (const r of reviews) {
      const rating = r.rating === null ? null : Math.min(5, Math.max(1, Math.round((r.rating / r.scale) * 5)));
      await this.reviews.save({
        id: `ext:${r.platform}:${r.externalId}`,
        target: input.target,
        origin: { kind: "external", platform: r.platform, externalId: r.externalId, author: r.author, url: r.url },
        rating,
        text: r.text,
        status: "published",
        createdAt: r.createdAt,
        updatedAt: now,
      });
    }
    return { imported: reviews.length, cursor };
  }

  async summary(target: ReviewTarget): Promise<RatingSummary> {
    const published = (await this.reviews.findByTarget(target, "published")).filter((r) => r.rating !== null);
    const avg = (xs: Review[]) => (xs.length ? Math.round((xs.reduce((s, r) => s + r.rating!, 0) / xs.length) * 10) / 10 : null);
    const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    for (const r of published) distribution[String(r.rating) as keyof typeof distribution]++;
    const groups = new Map<string, Review[]>();
    for (const r of published) {
      const k = reviewSourceLabel(r.origin);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return {
      target,
      count: published.length,
      average: avg(published),
      distribution,
      bySource: Object.fromEntries([...groups].map(([k, rs]) => [k, { count: rs.length, average: avg(rs) }])),
    };
  }
}

import type { ExternalReview, Review, ReviewStatus, ReviewTarget } from "../model";

export interface IReviewRepository {
  findById(id: string): Promise<Review | undefined>;
  findByTarget(target: ReviewTarget, status?: ReviewStatus): Promise<Review[]>;
  findByAuthor(userId: string): Promise<Review[]>;
  save(review: Review): Promise<void>;
  deleteByAuthor(userId: string): Promise<void>;
}

/** Lee reseñas de OTRA plataforma (tienda de apps, sitio de reseñas, foro...). Sólo lectura. */
export interface IReviewSource {
  readonly platform: string;
  pull(config: Record<string, string>, cursor?: string): Promise<{ reviews: ExternalReview[]; cursor?: string }>;
}

export type ModerationVerdict = "approve" | "reject" | "review";

/** Revisa el texto de una reseña (insultos, spam, datos personales). Reglas o IA. */
export interface IReviewModerator {
  moderate(text: string): Promise<{ verdict: ModerationVerdict; reason?: string }>;
}

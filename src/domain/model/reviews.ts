/**
 * CALIFICACIONES Y RESEÑAS.
 * Pueden ser internas (usuarios de la plataforma) o externas (tiendas de apps,
 * sitios de reseñas, foros). Todas terminan en el mismo modelo y se agregan juntas,
 * pero siempre se muestra de dónde viene cada una.
 */
export type ReviewTargetType =
  | "analysis" // un análisis de humo o comparación
  | "reply" // una respuesta publicada
  | "outlet" // un medio
  | "platform"; // la plataforma en sí

export interface ReviewTarget {
  type: ReviewTargetType;
  id: string;
}

export type ReviewOrigin =
  | { kind: "internal"; userId: string }
  | { kind: "external"; platform: string; externalId: string; author?: string; url?: string };

export type ReviewStatus = "published" | "pending_moderation" | "rejected";

export interface Review {
  id: string;
  target: ReviewTarget;
  origin: ReviewOrigin;
  /** 1 a 5 estrellas. `null` si es sólo un comentario. */
  rating: number | null;
  text?: string;
  status: ReviewStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface RatingSummary {
  target: ReviewTarget;
  count: number;
  average: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  /** Separado por origen: "interna", "appstore", "googleplay"... */
  bySource: Record<string, { count: number; average: number | null }>;
}

/** Reseña tal como viene de otra plataforma, antes de normalizar. */
export interface ExternalReview {
  platform: string;
  externalId: string;
  author?: string;
  rating: number | null;
  /** Escala original (p. ej. 5 o 10), para normalizar a 1–5. */
  scale: number;
  text?: string;
  url?: string;
  createdAt: Date;
}

export function reviewSourceLabel(origin: ReviewOrigin): string {
  return origin.kind === "internal" ? "interna" : origin.platform;
}

/**
 * REDES SOCIALES COMO FUENTE: mucha desinformación circula como link a un posteo, un video o
 * un reel. Se lee lo que dice (texto, título, descripción) y quién lo publicó, sólo por vías
 * permitidas por cada plataforma: APIs oficiales, oEmbed y metadatos públicos del link.
 */
export type SocialPlatform = "youtube" | "x" | "facebook" | "instagram" | "tiktok" | "telegram" | "threads" | "web";

export interface SocialPost {
  platform: SocialPlatform;
  url: string;
  /** Id del posteo en la plataforma, si se conoce. */
  postId?: string;
  author?: { name?: string; handle?: string; url?: string };
  publishedAt?: Date;
  title?: string;
  /** Lo que dice: el texto del posteo, o título + descripción del video. */
  text: string;
  /** Números públicos, si la plataforma los da. */
  metrics?: { views?: number; likes?: number; comments?: number };
  /** Qué fuente lo leyó (API oficial, oEmbed, metadatos): cuánto confiar en lo que falta. */
  via: string;
}

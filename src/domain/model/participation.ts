import type { ResponseContent } from "./messaging";

// =====================================================================
// NARRATIVAS EN CIRCULACIÓN
// =====================================================================

/**
 * Una cadena (y sus variantes) que mucha gente manda a analizar.
 * Se detecta agrupando contenidos parecidos: es el "humo en circulación".
 */
export interface Narrative {
  id: string;
  /** Texto de muestra, con teléfonos y mails ocultos. */
  sample: string;
  /** Palabras que la caracterizan (para agrupar variantes). */
  keywords: string[];
  topic?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrences: number;
  byChannel: Record<string, number>;
  /** Apariciones por semana ISO ("2026-W39"): permite ver si crece o se apaga. */
  weekly: Record<string, number>;
  avgSmokeIndex: number;
  status: "circulating" | "countered" | "fading";
  /** Campañas lanzadas para contrarrestarla. */
  campaignIds: string[];
}

// =====================================================================
// CAMPAÑAS PARA CONTRARRESTAR EL HUMO
// =====================================================================

export type CampaignStatus = "draft" | "pending_review" | "approved" | "running" | "finished" | "rejected";

export type CampaignPieceKind = "short_text" | "card" | "thread" | "newsletter";

export interface CampaignPiece {
  kind: CampaignPieceKind;
  title: string;
  text: string;
  /** Imagen generada (tarjeta), guardada como SVG. */
  image?: { contentType: string; data: string };
}

export interface Campaign {
  id: string;
  /** Avisos para quien revisa (p. ej. riesgo de difamación). */
  riskNotes?: string[];
  ownerId: string;
  organizationId?: string;
  /** Quién emite: SIEMPRE visible en cada pieza. */
  sponsor: string;
  narrativeId?: string;
  /** La AFIRMACIÓN que se contrarresta (nunca una persona). */
  claim: string;
  /** Mensaje verificado, con fuentes. */
  message: ResponseContent;
  pieces: CampaignPiece[];
  /** Canales propios por los que se difunde (ids de ICampaignChannel). */
  channelIds: string[];
  topic?: string;
  /** Declarado por quien la crea y revisado por moderación: activa las reglas electorales. */
  political: boolean;
  status: CampaignStatus;
  createdAt: Date;
  reviewedBy?: string;
  reviewNote?: string;
  launchedAt?: Date;
  finishedAt?: Date;
}

/** Aliado: persona que ACEPTÓ recibir las piezas para compartirlas desde su cuenta, si quiere. */
export interface CampaignAlly {
  id: string;
  campaignId: string;
  userId: string;
  status: "invited" | "accepted" | "declined";
  invitedAt: Date;
  respondedAt?: Date;
}

export interface CampaignDelivery {
  id: string;
  campaignId: string;
  channelId: string;
  pieceIndex: number;
  ok: boolean;
  reach: number;
  externalId?: string;
  error?: string;
  at: Date;
}

export interface CampaignReport {
  campaignId: string;
  deliveries: number;
  reach: number;
  clicks: number;
  alliesAccepted: number;
  clicksByAlly: Record<string, number>;
  /** Circulación de la narrativa: promedio semanal antes y después del lanzamiento. */
  narrative?: { weeklyBefore: number; weeklyAfter: number; change: number | null };
}

// =====================================================================
// OTRA MIRADA
// =====================================================================

/** Igual que los desacuerdos: sobre hechos, sobre interpretación o sobre valores. */
export type PerspectiveKind = "fact" | "interpretation" | "values";

export interface PerspectiveTarget {
  type: "analysis" | "narrative" | "credibility" | "topic";
  id: string;
}

export interface Perspective {
  id: string;
  target: PerspectiveTarget;
  authorId: string;
  /** Cómo se presenta el autor: persona, organización o medio (si lo representa). */
  authorAs: "person" | "organization" | "outlet";
  kind: PerspectiveKind;
  text: string;
  sources: { label: string; url: string }[];
  /** Cuestiona el análisis de la PLATAFORMA (si es sobre hechos, va a verificación). */
  challengesPlatform: boolean;
  status: "published" | "pending_moderation" | "rejected";
  helpful: number;
  notHelpful: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PerspectiveVote {
  id: string;
  perspectiveId: string;
  userId: string;
  helpful: boolean;
  at: Date;
}

// =====================================================================
// SALAS EN TIEMPO REAL (organizaciones)
// =====================================================================

export interface Room {
  id: string;
  organizationId: string;
  name: string;
  topic?: string;
  /** Sobre qué se trabaja: una tarea de verificación, una campaña, un análisis… */
  linkedTo?: { type: string; id: string };
  createdBy: string;
  createdAt: Date;
  archived: boolean;
  /** Segundos mínimos entre mensajes de una misma persona (0 = libre). */
  slowModeSeconds: number;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  authorId: string;
  text: string;
  links: string[];
  /** Mensajes con cifras y sin link se marcan "sin fuente" hasta que alguien la agregue. */
  flags: ("sin_fuente")[];
  replyTo?: string;
  at: Date;
  deleted: boolean;
}

export type RoomEvent =
  | { type: "message"; message: RoomMessage }
  | { type: "deleted"; messageId: string }
  | { type: "presence"; userIds: string[] };

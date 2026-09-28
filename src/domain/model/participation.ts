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
// SALAS EN TIEMPO REAL (equipos de una organización y eventos públicos)
// =====================================================================

/** Sin tipo = sala de equipo (así quedan las salas que ya existían). */
export type RoomKind = "team" | "event";

/**
 * Evento en vivo (debate, elecciones, cadena nacional): sala pública con horario, anfitrión,
 * chequeos fijados y participantes silenciados. Cualquiera lee; escribir tiene reglas.
 */
export interface EventInfo {
  /** Corto, para "/evento <código>" y para el link público. */
  code: string;
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  closedAt?: Date;
  /** Quién organiza (se muestra): un medio, una ONG, Sin Humo… */
  host: string;
  muted: { userId: string; until: Date }[];
  /** Chequeos fijados arriba (ids de mensajes). */
  pinned: string[];
}

export interface Room {
  id: string;
  kind?: RoomKind;
  /** Sólo en las salas de equipo. */
  organizationId?: string;
  event?: EventInfo;
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
  /**
   * "sin_fuente": cifras sin link (hasta que alguien la agregue).
   * "verificacion": chequeo publicado por el equipo del evento (se fija arriba).
   */
  flags: ("sin_fuente" | "verificacion")[];
  /** En eventos públicos: seudónimo estable por sala ("Participante 4F2A"), nunca el nombre ni el número. */
  alias?: string;
  replyTo?: string;
  at: Date;
  deleted: boolean;
}

/** Lo que ve el público de un mensaje de un evento: sin quién lo escribió (sólo el seudónimo). */
export type PublicRoomMessage = Omit<RoomMessage, "authorId">;

export type RoomEvent =
  | { type: "message"; message: RoomMessage | PublicRoomMessage }
  | { type: "deleted"; messageId: string }
  /** En equipos, quiénes están; en eventos, cuántos (no quiénes). */
  | { type: "presence"; userIds?: string[]; count?: number }
  | { type: "closed" };

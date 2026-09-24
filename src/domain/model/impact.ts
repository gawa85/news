import type { Period } from "./common";

/**
 * IMPACTO de una respuesta publicada. Cada destino aporta lo que puede medir
 * (un foro da vistas y "me gusta"; WhatsApp da entregado/leído; un mail, si respondieron).
 * Todo es opcional: nunca se inventa un número que el destino no informa.
 */
export interface ImpactMetrics {
  delivered?: boolean;
  read?: boolean;
  views?: number;
  reactionsPositive?: number;
  reactionsNegative?: number;
  replies?: number;
  /** Clics en links de seguimiento propios (sin datos personales: sólo conteo). */
  clicks?: number;
  shares?: number;
  /** La publicación original a la que se respondió fue editada/corregida. */
  originalCorrected?: boolean;
  /** La publicación original fue borrada. */
  originalRemoved?: boolean;
  /** Nuestra respuesta fue borrada o marcada como spam por el sitio. */
  replyRemoved?: boolean;
}

export interface ImpactSnapshot {
  id: string;
  replyId: string;
  destination: string;
  topic?: string;
  collectedAt: Date;
  metrics: ImpactMetrics;
}

/** Link propio que redirige al destino real y cuenta clics. */
export interface TrackedLink {
  code: string;
  replyId: string;
  url: string;
  clicks: number;
  createdAt: Date;
}

export interface ImpactTotals {
  published: number;
  views: number;
  reactionsPositive: number;
  reactionsNegative: number;
  replies: number;
  clicks: number;
  originalsCorrected: number;
  originalsRemoved: number;
  repliesRemoved: number;
}

export interface ImpactReport {
  period: Period;
  totals: ImpactTotals;
  byDestination: ({ destination: string } & ImpactTotals)[];
  byTopic: ({ topic: string } & ImpactTotals)[];
  /** Respuestas eliminadas / publicadas: si sube, hay que revisar tono o frecuencia. */
  removalRate: number | null;
  /** Originales corregidos / respuestas: el indicador más fuerte de impacto real. */
  correctionRate: number | null;
}

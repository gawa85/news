/**
 * COSTOS: cuánto le cuesta a la plataforma atender a cada cliente (IA, mensajes, mails…).
 * Sirve para saber si cada plan deja margen y para detectar abusos.
 */
export type CostKind = "llm" | "message" | "email" | "speech_to_text" | "text_to_speech" | "ocr" | "translation";

export interface CostEvent {
  id: string;
  /** Quién paga (usuario u organización). "sistema" si no hay un cliente detrás. */
  subjectId: string;
  userId?: string;
  action?: string;
  kind: CostKind;
  provider: string;
  units: { inputTokens?: number; outputTokens?: number; messages?: number; seconds?: number; images?: number; characters?: number };
  costUsd: number;
  at: Date;
}

/** Precios de proveedores. Son DATOS: cargar los vigentes de cada proveedor. */
export interface PriceTable {
  llm: Record<string, { inputPerMillionTokensUsd: number; outputPerMillionTokensUsd: number }>;
  perMessageUsd: Record<string, number>;
  speechToTextPerMinuteUsd: number;
  /** Texto a voz, por millón de caracteres. */
  textToSpeechPerMillionCharsUsd?: number;
  ocrPerImageUsd: number;
  translationPerMillionCharsUsd: number;
}

export interface SubjectCost {
  subjectId: string;
  planId?: string;
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  /** Costo / ingreso. En el plan gratis, el costo absoluto. */
  costShare: number | null;
  overBudget: boolean;
}

export interface CostReport {
  period: { from: Date; to: Date };
  totalCostUsd: number;
  totalRevenueUsd: number;
  byProvider: Record<string, number>;
  bySubject: SubjectCost[];
}

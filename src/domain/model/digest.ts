/**
 * RESUMEN DIARIO O SEMANAL: lo que pasó en los temas que sigue la persona, las notas que
 * vigila (ediciones, borrados), las cadenas que circulan y las fe de erratas. Cada parte
 * la arma una fuente independiente: sumar una parte nueva = sumar una fuente.
 */
export type DigestKind = "daily" | "weekly";

export interface DigestItem {
  text: string;
  url?: string;
}

export interface DigestSection {
  /** Qué fuente la armó (para medir qué partes se leen). */
  source: string;
  title: string;
  items: DigestItem[];
  /** Cuántos más hay además de los que se muestran. */
  more?: number;
}

export interface Digest {
  userId: string;
  kind: DigestKind;
  period: { from: Date; to: Date };
  sections: DigestSection[];
}

/** Registro de cada envío: evita duplicados (un resumen por persona y período) y marca desde cuándo contar. */
export interface DigestDelivery {
  /** `${userId}:${periodKey}`: la base garantiza uno solo. */
  id: string;
  userId: string;
  kind: DigestKind;
  /** "2026-09-24" (diario) o "2026-W39" (semanal), en la hora local de la persona. */
  periodKey: string;
  from: Date;
  to: Date;
  status: "sending" | "sent" | "deferred" | "empty" | "failed";
  items: number;
  channel?: string;
  error?: string;
  at: Date;
}

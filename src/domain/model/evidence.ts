/**
 * ARCHIVO DE EVIDENCIAS: copia de una nota o página tal como estaba en un momento dado,
 * con huella (SHA-256), sello de tiempo de un tercero y copias externas. Sirve para
 * probar lo que se publicó aunque después lo editen en silencio o lo borren.
 */
export type EvidenceStatus =
  | "captured" // copia guardada
  | "gone" // la página ya no existe (404/410): se registra el borrado
  | "failed"; // no se pudo bajar (error de red, bloqueada, demasiado grande)

export type EvidenceReason = "manual" | "recheck";

export interface EvidenceBlobRef {
  /** raw = el archivo como llegó; text = el texto normalizado (lo que se compara). */
  kind: "raw" | "text";
  provider: string;
  key: string;
}

export interface EvidenceChange {
  /** Frases que aparecieron / desaparecieron respecto de la captura anterior. */
  added: string[];
  removed: string[];
}

export interface EvidenceSnapshot {
  id: string;
  /** Lo que se pidió, adonde terminó (redirecciones) y la clave que agrupa las versiones. */
  url: string;
  finalUrl: string;
  urlKey: string;
  capturedAt: Date;
  requestedBy: string;
  /** Quién paga (usuario u organización); "sistema" para las verificaciones automáticas. */
  subjectId: string;
  reason: EvidenceReason;
  status: EvidenceStatus;
  httpStatus?: number;
  error?: string;
  title?: string;
  mime?: string;
  bytes?: number;
  /** Huella del archivo tal como llegó. */
  rawSha256?: string;
  /** Huella del texto normalizado: igual = misma nota aunque cambie el HTML alrededor. */
  textSha256?: string;
  blobs: EvidenceBlobRef[];
  /** Captura anterior de la misma URL y qué cambió desde entonces. */
  previousId?: string;
  change?: EvidenceChange;
  /**
   * Cadena: huella de este registro incluyendo la del anterior de la misma URL.
   * Si alguien toca un registro viejo en la base, la cadena deja de cerrar.
   */
  recordHash: string;
  previousRecordHash?: string;
  /** Sello de tiempo de un tercero sobre `recordHash` (se agrega después, por la cola). */
  timestamp?: { provider: string; token: string; at: Date };
  /** Copias en archivos públicos independientes (Wayback Machine…). */
  externalCopies: { provider: string; url: string; at: Date }[];
  /** Hasta cuándo se vuelve a mirar la página para detectar ediciones o borrados. */
  monitorUntil?: Date;
  /** Última vez que se volvió a mirar (sin cambios no se crea otra captura). */
  lastCheckedAt?: Date;
  /** Captura más nueva de la misma URL (la vigente es la que no tiene). */
  supersededBy?: string;
}

export interface EvidenceVerification {
  snapshotId: string;
  ok: boolean;
  checks: { name: string; ok: boolean; detail?: string }[];
}

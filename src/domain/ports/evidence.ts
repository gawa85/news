import type { EvidenceSnapshot } from "../model";

/** Una página bajada tal como la sirvió el sitio. */
export interface CapturedPage {
  finalUrl: string;
  status: number;
  mime: string;
  body: Buffer;
  title?: string;
  /** Texto visible (sin HTML, scripts ni estilos). */
  text: string;
}

/** Baja una página para archivarla (HTTP directo, un navegador sin cabeza, un servicio…). */
export interface IPageCapturer {
  readonly id: string;
  /** Rechaza direcciones internas (SSRF) y archivos más grandes que `maxBytes`. */
  capture(url: string, maxBytes: number): Promise<CapturedPage>;
}

/** Dónde se guardan las copias (la base, un disco, S3/R2…). */
export interface IEvidenceBlobStore {
  readonly provider: string;
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
}

/** Sello de tiempo de un tercero de confianza (RFC 3161…): prueba que la huella existía en ese momento. */
export interface ITimestampAuthority {
  readonly id: string;
  stamp(sha256Hex: string): Promise<{ token: string; at: Date }>;
}

/** Archivo público independiente (Wayback Machine, archive.today…). */
export interface IExternalArchive {
  readonly id: string;
  archive(url: string): Promise<{ url: string; at: Date }>;
}

export interface IEvidenceRepository {
  save(s: EvidenceSnapshot): Promise<void>;
  findById(id: string): Promise<EvidenceSnapshot | undefined>;
  /** Todas las capturas de una misma nota, de la más vieja a la más nueva. */
  findByUrlKey(urlKey: string): Promise<EvidenceSnapshot[]>;
  findByRequester(userId: string, limit: number): Promise<EvidenceSnapshot[]>;
  countByRequesterSince(userId: string, since: Date): Promise<number>;
  /** Las capturas que paga un cliente (incluidas las del seguimiento automático). */
  findBySubject(subjectId: string): Promise<EvidenceSnapshot[]>;
  /** Últimas capturas de notas en seguimiento que hay que volver a mirar. */
  findDueForRecheck(now: Date, checkedBefore: Date, limit: number): Promise<EvidenceSnapshot[]>;
}

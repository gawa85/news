import type { MediaFingerprint, MediaInspection } from "../model";

/** Lee un archivo de imagen o video: datos internos y huellas. Local, sin servicios externos. */
export interface IMediaInspector {
  /** undefined si el formato no se sabe leer. */
  inspect(data: Buffer, mime: string): Promise<MediaInspection | undefined>;
}

/** Huellas de lo que ya circuló (sin el archivo ni quién lo mandó). */
export interface IMediaFingerprintRepository {
  get(sha256: string): Promise<MediaFingerprint | undefined>;
  /** Candidatas a parecidas: comparten alguna parte de la huella perceptual (ver hashBands). */
  findByBands(bands: string[], limit: number): Promise<MediaFingerprint[]>;
  save(fp: MediaFingerprint, bands: string[]): Promise<void>;
}

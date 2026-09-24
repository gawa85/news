/**
 * OPERACIÓN: copias de seguridad.
 */

/** Acceso "crudo" a todas las colecciones (documentos serializados), para respaldar y restaurar. */
export interface IRawStore {
  /** Colecciones que se respaldan (sin las efímeras: sesiones, códigos, intentos de login…). */
  collections(): string[];
  read(name: string): Promise<string[]>;
  write(name: string, docs: string[]): Promise<void>;
  count(name: string): Promise<number>;
}

/** Dónde se guardan las copias: disco, S3/R2/MinIO, etc. Idealmente en OTRA cuenta/proveedor. */
export interface IBackupSink {
  readonly id: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | undefined>;
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

export interface BackupManifest {
  formatVersion: 1;
  id: string;
  key: string;
  kind: "daily" | "manual" | "pre_migration" | "staging_copy";
  createdAt: string;
  engine: string;
  environment: string;
  scrubbed: boolean;
  collections: Record<string, number>;
  bytes: number;
  sha256: string;
  verifiedAt?: string;
  verification?: { ok: boolean; detail: string };
}

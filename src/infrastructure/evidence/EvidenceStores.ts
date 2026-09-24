/**
 * Dónde se guardan las copias archivadas. Dos adaptadores del mismo puerto (LSP):
 *  - en la base (por defecto: funciona sin configurar nada);
 *  - sobre cualquier IBackupSink (disco, S3/R2/MinIO): reusa esos adaptadores sin duplicarlos.
 */
import type { IBackupSink, IEvidenceBlobRepository, IEvidenceBlobStore } from "../../domain/ports";

export class DatabaseEvidenceBlobStore implements IEvidenceBlobStore {
  readonly provider = "base";

  constructor(private readonly repo: IEvidenceBlobRepository) {}

  async put(key: string, data: Buffer, mime: string): Promise<void> {
    await this.repo.put({ key, mime, dataBase64: data.toString("base64") });
  }

  async get(key: string): Promise<Buffer | undefined> {
    const b = await this.repo.get(key);
    return b ? Buffer.from(b.dataBase64, "base64") : undefined;
  }
}

/** Adaptador: un IBackupSink usado como depósito de evidencias (el tipo MIME queda en el registro). */
export class SinkEvidenceBlobStore implements IEvidenceBlobStore {
  readonly provider: string;

  constructor(private readonly sink: IBackupSink) {
    this.provider = sink.id;
  }

  put(key: string, data: Buffer): Promise<void> {
    return this.sink.put(key, data);
  }

  get(key: string): Promise<Buffer | undefined> {
    return this.sink.get(key);
  }
}

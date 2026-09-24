import type { EvidenceItem, OfficialDocument, VerificationTask, VerificationTaskStatus } from "../model";

export interface IVerificationTaskRepository {
  findById(id: string): Promise<VerificationTask | undefined>;
  findByStatus(status: VerificationTaskStatus, limit: number): Promise<VerificationTask[]>;
  /** Inserta; ConflictError si ya existe (misma disputa ya cargada). */
  insert(task: VerificationTask): Promise<void>;
  save(task: VerificationTask): Promise<void>;
}

export interface IOfficialDocumentRepository {
  findByTopic(topic: string): Promise<OfficialDocument[]>;
  save(doc: OfficialDocument): Promise<void>;
}

/**
 * FUENTE PRIMARIA: busca evidencia oficial para una tarea de verificación
 * (series estadísticas, boletines, documentos cargados…). Una clase por fuente.
 */
export interface IPrimarySourceProvider {
  readonly id: string;
  readonly label: string;
  lookup(task: VerificationTask): Promise<Omit<EvidenceItem, "addedBy" | "addedAt">[]>;
}

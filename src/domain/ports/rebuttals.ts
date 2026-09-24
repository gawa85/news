import type { Correction, Rebuttal } from "../model";

export interface IRebuttalRepository {
  findById(id: string): Promise<Rebuttal | undefined>;
  findByOutlet(outletId: string): Promise<Rebuttal[]>;
  findPending(limit: number): Promise<Rebuttal[]>;
  save(rebuttal: Rebuttal): Promise<void>;
}

export interface ICorrectionRepository {
  findRecent(limit: number): Promise<Correction[]>;
  findByOutlet(outletId: string): Promise<Correction[]>;
  save(correction: Correction): Promise<void>;
}

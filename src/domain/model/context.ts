import type { Period, Region } from "./common";

export type PoliticalEventKind = "government_change" | "election" | "policy" | "other";

export interface PoliticalEvent {
  date: Date;
  kind: PoliticalEventKind;
  description: string;
}

export interface GoverningForce {
  name: string;
  jurisdiction: "national" | "provincial" | "municipal";
  from: Date;
  to?: Date;
}

/** Coyuntura política de una región en un período. */
export interface PoliticalContext {
  region: Region;
  period: Period;
  governingForces: GoverningForce[];
  events: PoliticalEvent[];
}

/** Pauta oficial: dinero que un gobierno le paga a un medio en publicidad. */
export interface AdvertisingSpend {
  outletId: string;
  payer: string;
  jurisdiction: "national" | "provincial" | "municipal";
  amount: number;
  currency: string;
  period: Period;
  /** Dataset de origen (p. ej. datos abiertos de pauta de un gobierno). */
  source?: string;
}

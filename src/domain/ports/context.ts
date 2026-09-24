/**
 * Puertos de CONTEXTO: dueños de medios, pauta oficial y coyuntura política.
 * Cada fuente de contexto es independiente y se puede alimentar distinto
 * (registro público, carga manual, scraping del Boletín Oficial, etc.).
 */
import type { AdvertisingSpend, Owner, Period, PoliticalContext, Region } from "../model";

export interface IOwnershipRegistry {
  ownersAt(outletId: string, date: Date): Promise<Owner[]>;
}

export interface IOfficialAdvertisingSource {
  spendFor(outletId: string, period: Period): Promise<AdvertisingSpend[]>;
}

export interface IPoliticalContextProvider {
  contextFor(region: Region, period: Period): Promise<PoliticalContext>;
}

/** Qué sectores económicos toca un tema ("tarifas de gas" → energía). */
export interface ITopicSectorMapper {
  sectorsFor(topic: string): string[];
}

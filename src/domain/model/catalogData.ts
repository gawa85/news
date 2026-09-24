import type { AdvertisingSpend } from "./context";
import type { Outlet, Owner, OwnershipRecord } from "./source";

/** Feed RSS/Atom de un medio del catálogo (de ahí salen las notas reales). */
export interface FeedSource {
  id: string;
  outletId: string;
  url: string;
  active: boolean;
  lastFetchedAt?: Date;
  lastError?: string;
}

/** Tema con sus palabras clave: se usa para clasificar las notas que llegan. */
export interface TopicDefinition {
  name: string;
  keywords: string[];
}

/** Lo que trae una fuente del catálogo (un CSV de medios, un dataset de pauta oficial…). */
export interface CatalogBatch {
  outlets?: Outlet[];
  owners?: Owner[];
  ownership?: OwnershipRecord[];
  advertising?: AdvertisingSpend[];
  feeds?: FeedSource[];
  /** Filas que no se pudieron asociar a un medio (p. ej. un nombre desconocido). */
  unmatched?: string[];
}

export interface ImportReport {
  sourceId: string;
  outlets: number;
  owners: number;
  ownership: number;
  advertising: number;
  feeds: number;
  unmatched: string[];
  rejected: string[];
  /** Datos que se cargaron pero conviene revisar (p. ej. una provincia desconocida). */
  warnings: string[];
}

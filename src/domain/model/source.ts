import type { Region } from "./common";

export type OutletKind = "newspaper" | "digital" | "tv" | "radio" | "wire_agency" | "official";

/** Un medio o fuente de información. */
export interface Outlet {
  id: string;
  name: string;
  url: string;
  kind: OutletKind;
  region: Region;
  /** Otros nombres con que aparece (p. ej. en los datasets de pauta oficial). */
  aliases?: string[];
}

/** Dueño (persona o grupo) de uno o varios medios, con los sectores donde tiene negocios. */
export interface Owner {
  id: string;
  name: string;
  businessSectors: string[];
}

/** La propiedad cambia con el tiempo: se registra con fechas. */
export interface OwnershipRecord {
  outletId: string;
  ownerId: string;
  since: Date;
  until?: Date;
  /** De dónde sale el dato (registro público, investigación, declaración del medio). */
  source?: string;
}

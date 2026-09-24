import type { DigestDelivery, DigestSection, EffectivePreferences, User } from "../model";

export interface DigestContext {
  user: User;
  prefs: EffectivePreferences;
  from: Date;
  to: Date;
}

/**
 * Una parte del resumen (temas seguidos, notas vigiladas, cadenas, fe de erratas…).
 * Devuelve undefined si no tiene nada para contar: el resumen se arma sólo con lo que hay.
 */
export interface IDigestSource {
  readonly id: string;
  collect(ctx: DigestContext): Promise<DigestSection | undefined>;
}

export interface IDigestDeliveryRepository {
  /** ConflictError si ya existe (otro servidor lo está mandando o ya se mandó). */
  insert(d: DigestDelivery): Promise<void>;
  save(d: DigestDelivery): Promise<void>;
  /** El último envío hecho (para contar "desde el último resumen"). */
  findLastSent(userId: string): Promise<DigestDelivery | undefined>;
  findByUser(userId: string, limit: number): Promise<DigestDelivery[]>;
  deleteByUser(userId: string): Promise<void>;
}

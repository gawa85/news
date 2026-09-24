import type { ChannelType } from "./identity";
import type { BillingSubject } from "./plans";
import type { UrlRules } from "./urlRules";

/**
 * Reglas que define el usuario (o su organización) y se aplican automáticamente
 * en cada análisis. Ej.: "nunca uses opinionesya.example".
 *
 * Reglas de la ORGANIZACIÓN: obligatorias para sus miembros. Un miembro no puede
 * incluir una URL que la organización excluyó.
 */
export interface SavedRuleSet {
  id: string;
  owner: BillingSubject;
  name: string;
  urlRules: UrlRules;
  active: boolean;
  createdAt: Date;
}

export type AlertTrigger =
  | "new_coverage" // hay notas nuevas sobre el tema
  | "new_disagreement" // aparece un dato en disputa
  | "credibility_change"; // cambia la credibilidad de un medio en el tema

export interface AlertRule {
  id: string;
  userId: string;
  topic: string;
  trigger: AlertTrigger;
  channel: ChannelType;
  /** Para "credibility_change": qué medio seguir. */
  outletId?: string;
  active: boolean;
  createdAt: Date;
  /** Hasta cuándo se evaluó, y lo que ya se avisó (para no repetir). */
  lastCheckedAt?: Date;
  lastState?: Record<string, unknown>;
}

/** Resultado de evaluar una alerta: qué avisar. */
export interface AlertHit {
  title: string;
  lines: string[];
  links: { label: string; url: string }[];
}

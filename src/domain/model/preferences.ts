import type { ChannelType } from "./identity";

/**
 * PREFERENCIAS de cada persona. La organización puede fijar valores por defecto
 * y BLOQUEAR algunos (sus miembros no los pueden cambiar).
 * Efectivas = sistema ← organización ← persona (salvo lo bloqueado, donde gana la organización).
 */
export type ResponseFormat = "short" | "detailed" | "easy_read";
export type DigestFrequency = "off" | "daily" | "weekly";

export interface QuietHours {
  /** "HH:MM" en hora local. Si from > to, cruza la medianoche (22:00 → 08:00). */
  from: string;
  to: string;
  utcOffsetMinutes: number;
}

export interface PreferenceValues {
  /** Temas que sigue (ids de la taxonomía). */
  followedTopics: string[];
  /** Categorías que no quiere recibir (avisos y campañas). */
  mutedCategories: string[];
  responseFormat: ResponseFormat;
  language: string;
  quietHours: QuietHours | null;
  digest: DigestFrequency;
  /** Orden de canales para avisos (el primero verificado que funcione). */
  notifyChannels: ChannelType[];
  /** Además del texto, mandar la respuesta en audio. */
  audioReplies: boolean;
}

export type PreferenceKey = keyof PreferenceValues;

export interface UserPreferences {
  userId: string;
  values: Partial<PreferenceValues>;
  updatedAt: Date;
}

export interface OrgPreferenceDefaults {
  organizationId: string;
  values: Partial<PreferenceValues>;
  locked: PreferenceKey[];
  updatedAt: Date;
  updatedBy: string;
}

export const SYSTEM_PREFERENCES: PreferenceValues = {
  followedTopics: [],
  mutedCategories: [],
  responseFormat: "detailed",
  language: "es",
  quietHours: null,
  digest: "off",
  notifyChannels: [],
  audioReplies: false,
};

export interface EffectivePreferences extends PreferenceValues {
  /** De dónde salió cada valor (para mostrarlo en la configuración). */
  source: Record<PreferenceKey, "system" | "organization" | "user" | "locked">;
}

export function resolvePreferences(user?: UserPreferences, org?: OrgPreferenceDefaults): EffectivePreferences {
  const out = { ...SYSTEM_PREFERENCES } as PreferenceValues;
  const source = Object.fromEntries(Object.keys(SYSTEM_PREFERENCES).map((k) => [k, "system"])) as EffectivePreferences["source"];
  const set = <K extends PreferenceKey>(k: K, v: PreferenceValues[K] | undefined, from: EffectivePreferences["source"][K]) => {
    if (v === undefined) return;
    out[k] = v;
    source[k] = from;
  };
  for (const k of Object.keys(SYSTEM_PREFERENCES) as PreferenceKey[]) {
    set(k, org?.values[k] as never, "organization");
    if (org?.locked.includes(k)) {
      source[k] = "locked";
      continue;
    }
    set(k, user?.values[k] as never, "user");
  }
  return { ...out, source };
}

/** Si ahora es horario de silencio, devuelve cuándo termina; si no, undefined. */
export function quietUntil(q: QuietHours | null, now: Date): Date | undefined {
  if (!q) return undefined;
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const local = new Date(now.getTime() + q.utcOffsetMinutes * 60_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const from = toMin(q.from);
  const to = toMin(q.to);
  const inside = from <= to ? minute >= from && minute < to : minute >= from || minute < to;
  if (!inside) return undefined;
  const addDays = from > to && minute >= from ? 1 : 0;
  const endLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + addDays, Math.floor(to / 60), to % 60);
  return new Date(endLocal - q.utcOffsetMinutes * 60_000);
}

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

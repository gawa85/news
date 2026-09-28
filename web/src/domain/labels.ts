/** Textos para personas (en castellano rioplatense, como el resto del producto). */
import type { AlertTrigger, Price, SmokeType, SocialPlatform } from "../api/types";

export const SMOKE_LABELS: Record<SmokeType, string> = {
  inflated_adjective: "Adjetivo inflado",
  vague_promise: "Promesa vaga",
  filler: "Relleno",
  alarmism: "Alarmismo",
  marketing: "Lenguaje de marketing",
  unsourced_claim: "Afirmación sin fuente",
  chain_call: "Pedido de reenvío",
  ai_manipulation: "Intento de manipular a la IA",
};

export const PLATFORM_NAMES: Record<SocialPlatform, string> = {
  youtube: "YouTube", x: "X (Twitter)", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", telegram: "Telegram", threads: "Threads", web: "la web",
};

/** Qué tan "humo" es un índice (0 a 100), en palabras: la información nunca depende sólo del color. */
export function smokeVerdict(index: number): { label: string; tone: "fact" | "smoke" | "danger" } {
  if (index < 20) return { label: "Mayormente datos", tone: "fact" };
  if (index < 50) return { label: "Tiene algo de humo", tone: "smoke" };
  if (index < 75) return { label: "Mucho humo", tone: "smoke" };
  return { label: "Casi todo humo", tone: "danger" };
}

export function credibilityVerdict(score: number | null): string {
  if (score === null) return "Sin datos suficientes";
  if (score >= 0.75) return "Alta";
  if (score >= 0.5) return "Media";
  if (score >= 0.3) return "Baja";
  return "Muy baja";
}

const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

export function formatPrice(p: Price | null | undefined): string {
  if (!p) return "Gratis";
  const amount = new Intl.NumberFormat("es-AR", { style: "currency", currency: p.currency, maximumFractionDigits: 0 }).format(p.amount);
  return `${amount} / ${p.interval === "month" ? "mes" : "año"}`;
}

export const formatNumber = (n: number) => new Intl.NumberFormat("es-AR").format(n);

/** Límite de un plan en palabras. */
export const limitText = (n: number | null, unit: string) => (n === null ? `${unit} sin límite` : `${formatNumber(n)} ${unit}`);

export const ALERT_TRIGGERS: Record<AlertTrigger, { label: string; hint: string }> = {
  new_coverage: { label: "Notas nuevas", hint: "Te avisamos cuando aparecen notas nuevas sobre el tema." },
  new_disagreement: { label: "Datos en disputa", hint: "Te avisamos cuando los medios dan datos distintos sobre lo mismo." },
  credibility_change: { label: "Cambio de credibilidad", hint: "Te avisamos si la credibilidad de un medio en el tema sube o baja." },
};

export const CHANNEL_NAMES: Record<string, string> = { email: "Mail", whatsapp: "WhatsApp", telegram: "Telegram", sms: "SMS", web: "Web", api: "API" };

/** Permisos que se le pueden dar a una clave de API, en palabras. */
export const SCOPE_LABELS: Record<string, string> = {
  "smoke:analyze": "Analizar textos",
  "content:analyze": "Analizar mensajes, mails y links",
  "sources:compare": "Comparar fuentes",
  "origin:trace": "Rastrear el origen de una nota",
  "credibility:view": "Ver la credibilidad de los medios",
  "credibility:timeline": "Ver la evolución de la credibilidad",
  "alerts:own": "Alertas",
  "rules:own": "Reglas de fuentes propias",
  "replies:private": "Responder en privado",
  "replies:publish_public": "Proponer respuestas públicas",
  "evidence:capture": "Guardar notas en el archivo",
  "perspectives:write": "Publicar otras miradas",
  "sources:connect": "Conectar buzones y feeds",
};

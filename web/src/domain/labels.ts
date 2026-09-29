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

/** Eventos a los que se suscribe un webhook, en palabras. */
export const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  "analysis.completed": "Terminó un análisis",
  "comparison.completed": "Terminó una comparación de fuentes",
  "alert.triggered": "Saltó una alerta",
  "reply.pending_review": "Una respuesta pública espera revisión",
  "reply.published": "Se publicó una respuesta",
  "rebuttal.submitted": "Un medio pidió derecho a réplica",
  "correction.published": "Se publicó una fe de erratas",
  "verification.resolved": "Se resolvió una verificación",
  "campaign.launched": "Se lanzó una campaña",
  "perspective.published": "Se publicó otra mirada",
};

/** Tipos de medio (los mismos que el servidor). */
export const OUTLET_KIND_LABELS: Record<string, string> = { newspaper: "Diario", digital: "Medio digital", tv: "Televisión", radio: "Radio", official: "Organismo oficial", wire_agency: "Agencia de noticias" };

/** Qué pasó, en palabras (auditoría). Si aparece uno nuevo sin traducir, se muestra el código. */
export const AUDIT_ACTIONS: Record<string, string> = {
  "analysis.completed": "Hizo un análisis",
  "comparison.completed": "Comparó fuentes",
  "alert.triggered": "Se disparó una alerta",
  "reply.pending_review": "Una respuesta pública quedó en revisión",
  "reply.published": "Se publicó una respuesta pública",
  "reply.reviewed": "Se revisó una respuesta pública",
  "rebuttal.submitted": "Un medio pidió réplica",
  "rebuttal.resolved": "Se resolvió una réplica",
  "correction.published": "Se publicó una fe de erratas",
  "verification.task_created": "Se creó una tarea de verificación",
  "verification.resolved": "Se resolvió una verificación",
  "campaign.launched": "Se lanzó una campaña",
  "campaign.reviewed": "Se revisó una campaña",
  "perspective.published": "Se publicó otra mirada",
  "role.assigned": "Se dio un rol",
  "role.removed": "Se quitó un rol",
  "organization.created": "Se creó una organización",
  "organization.invitation_sent": "Se invitó a alguien a la organización",
  "organization.member_joined": "Alguien se sumó a la organización",
  "organization.member_removed": "Alguien dejó la organización",
  "plan.change_requested": "Pidió cambiar de plan",
  "plan.changed": "Se cambió un plan",
  "plan.migration_scheduled": "Se programó mudar suscriptores de plan",
  "plan.migration_canceled": "Se canceló una mudanza de plan",
  "plan.migration_applied": "Se mudaron suscriptores de plan",
  "payment.confirmed": "Se confirmó un pago",
  "subscription.canceled": "Se canceló una suscripción",
  "subscription.resumed": "Se retomó una suscripción",
  "subscription.expired": "Terminó una suscripción",
  "invoice.issued": "Se emitió una factura",
  "coupon.created": "Se creó un cupón",
  "referral.rewarded": "Se premió una invitación",
  "rules.saved": "Se guardaron reglas de fuentes",
  "business_rule.changed": "Se cambió una regla del negocio",
  "parameter.changed": "Se cambió un parámetro",
  "feature_flag.changed": "Se cambió una función en prueba",
  "taxonomy.changed": "Se cambió un tema o categoría",
  "preferences.org_changed": "Se cambiaron las preferencias de la organización",
  "api_key.created": "Se creó una clave de API",
  "api_key.revoked": "Se revocó una clave de API",
  "webhook.registered": "Se registró un webhook",
  "webhook.removed": "Se quitó un webhook",
  "outlet_representative.assigned": "Se acreditó a un representante de medio",
  "outlet_representative.removed": "Se quitó a un representante de medio",
  "outlet.saved": "Se guardó un medio",
  "outlet.feed_changed": "Se cambió un feed de un medio",
  "catalog.imported": "Se importó el catálogo de medios",
  "model.promoted": "Se puso en uso otra versión del algoritmo",
  "user.registered": "Se creó una cuenta",
  "user.suspended": "Se suspendió una cuenta",
  "user.reactivated": "Se reactivó una cuenta",
  "channel.linked": "Se vinculó WhatsApp o Telegram",
  "auth.login": "Entró",
  "auth.login_failed": "Intento de entrada fallido",
  "auth.logout": "Salió",
  "export.generated": "Exportó datos",
  "report.sent": "Se mandó un reporte",
  "personal_data.exported": "Descargó sus datos personales",
  "personal_data.deleted": "Borró su cuenta y sus datos",
  "legal.published": "Se publicó una versión de términos o privacidad",
  "platform.profile_changed": "Se cambiaron los datos de la empresa",
  "branding.updated": "Se cambió la marca propia",
  "branding.domain_verified": "Se verificó un dominio propio",
  "support.ticket_created": "Se abrió una consulta de soporte",
  "support.ticket_updated": "Se actualizó una consulta de soporte",
  "learning.classroom_created": "Se creó un aula",
  "ops.backup_accessed": "Se entró a las copias de seguridad",
  "evidence.captured": "Se guardó una copia de una nota",
  "evidence.changed": "Una nota guardada cambió",
  "evidence.gone": "Una nota guardada desapareció",
  "abuse.restricted": "Se restringió a alguien (abuso)",
  "abuse.lifted": "Se levantó una restricción",
  "event.created": "Se creó un evento en vivo",
};

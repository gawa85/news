/**
 * CATÁLOGO: roles, planes y políticas por plataforma.
 * Son DATOS, no código: se cargan en la base y se pueden editar sin tocar el sistema.
 * Los precios son de ejemplo.
 */
import type { Feature, Permission, Plan, PlatformPolicy, Role } from "../domain/model";
import { PERMISSIONS } from "../domain/model";

const USE: Permission[] = [
  "smoke:analyze", "sources:compare", "origin:trace", "credibility:view", "credibility:timeline",
  "content:analyze", "sources:connect", "rules:own", "alerts:own", "replies:private", "api_keys:manage", "webhooks:manage",
  "perspectives:write", "rooms:use", "evidence:capture",
];

export const ROLES: Role[] = [
  { id: "reader", name: "Lector", description: "Usa todas las funciones que su plan habilita, para sí mismo.", scope: "organization", permissions: USE },
  { id: "analyst", name: "Analista", description: "Además puede proponer respuestas públicas y campañas (quedan en revisión).", scope: "organization", permissions: [...USE, "replies:publish_public", "campaigns:manage"] },
  { id: "moderator", name: "Moderador", description: "Aprueba o rechaza respuestas públicas y campañas, y ve reportes de impacto.", scope: "organization", permissions: [...USE, "replies:publish_public", "replies:moderate", "audit:read", "campaigns:manage", "campaigns:review", "stats:org"] },
  {
    id: "org_admin", name: "Administrador de organización", description: "Gestiona miembros, roles, plan y reglas de la organización.", scope: "organization",
    permissions: [...USE, "replies:publish_public", "replies:moderate", "audit:read", "users:read_org", "users:manage_org", "subscriptions:manage_org", "rules:org", "campaigns:manage", "campaigns:review", "stats:org", "learning:teach"],
  },
  { id: "fact_checker", name: "Verificador", description: "Verifica afirmaciones y resuelve réplicas de los medios.", scope: "platform", permissions: [...USE, "verdicts:write", "rebuttal:resolve", "corrections:publish", "quality:manage", "taxonomy:manage", "evidence:read_all"] },
  { id: "outlet_rep", name: "Representante de medio", description: "Ejerce el derecho a réplica sobre las evaluaciones de su medio.", scope: "platform", permissions: ["credibility:view", "credibility:timeline", "rebuttal:write"] },
  { id: "teacher", name: "Docente", description: "Crea aulas del modo aprendizaje y ve el progreso (por apodo) de sus estudiantes.", scope: "organization", permissions: ["smoke:analyze", "content:analyze", "sources:compare", "learning:teach"] },
  { id: "support_agent", name: "Soporte", description: "Atiende los tickets de soporte.", scope: "platform", permissions: ["support:handle"] },
  { id: "business_manager", name: "Gestión del negocio", description: "Reglas configurables, parámetros, temas y métricas del negocio.", scope: "platform", permissions: ["stats:business", "rules:business", "taxonomy:manage"] },
  { id: "platform_admin", name: "Administrador de la plataforma", description: "Todos los permisos.", scope: "platform", permissions: [...PERMISSIONS] },
];

const BASIC: Feature[] = ["smoke_analysis", "content_analysis", "source_comparison", "url_rules", "voice_notes", "screenshots"];
const PERSONAL: Feature[] = [...BASIC, "origin_trace", "credibility_meter", "alerts", "ai_engine", "source_connections", "audio_replies", "daily_digest"];
const PRO: Feature[] = [...PERSONAL, "credibility_timeline", "export", "api_access", "webhooks", "public_replies", "campaigns", "scheduled_reports", "evidence_archive"];

export const PLANS: Plan[] = [
  {
    id: "educacion", name: "Educación", tier: 0, audience: "organization", price: null,
    description: "Gratis para escuelas: modo aprendizaje '¿esto es humo?' con aulas y seguimiento docente.",
    features: [...BASIC, "learning_mode", "audio_replies"], channels: ["web", "whatsapp", "telegram", "email"],
    limits: { analysesPerDay: 200, comparisonsPerMonth: 100, maxSourcesPerComparison: 6, maxIncludeUrls: 0, maxSavedRuleSets: 5, maxAlerts: 0, maxSourceConnections: 0, seats: 500 },
  },
  {
    id: "gratis", name: "Gratis", tier: 0, audience: "individual", price: null,
    description: "Sacale el humo a lo que te llega por WhatsApp, Telegram o mail.",
    features: BASIC, channels: ["web", "whatsapp", "telegram", "email"],
    limits: { analysesPerDay: 5, comparisonsPerMonth: 3, maxSourcesPerComparison: 4, maxIncludeUrls: 0, maxSavedRuleSets: 1, maxAlerts: 0, maxSourceConnections: 0, seats: 1 },
  },
  {
    id: "personal", name: "Personal", tier: 1, audience: "individual", price: { amount: 4_990, currency: "ARS", interval: "month" }, yearlyPrice: { amount: 49_900, currency: "ARS", interval: "year" },
    description: "Para informarte en serio: credibilidad de medios, alertas y tu buzón conectado.",
    features: PERSONAL, channels: ["web", "whatsapp", "telegram", "email", "sms"],
    limits: { analysesPerDay: 50, comparisonsPerMonth: 60, maxSourcesPerComparison: 8, maxIncludeUrls: 5, maxSavedRuleSets: 10, maxAlerts: 5, maxSourceConnections: 1, seats: 1 },
  },
  {
    id: "profesional", name: "Profesional", tier: 2, audience: "individual", price: { amount: 14_990, currency: "ARS", interval: "month" }, yearlyPrice: { amount: 149_900, currency: "ARS", interval: "year" },
    description: "Periodistas, consultores y creadores: API, MCP, webhooks y respuestas públicas.",
    features: PRO, channels: ["web", "api", "whatsapp", "telegram", "email", "sms"],
    limits: { analysesPerDay: 500, comparisonsPerMonth: 1_000, maxSourcesPerComparison: 20, maxIncludeUrls: 20, maxSavedRuleSets: 50, maxAlerts: 30, maxSourceConnections: 5, seats: 1 },
  },
  {
    id: "equipo", name: "Equipo", tier: 3, audience: "organization", price: { amount: 79_990, currency: "ARS", interval: "month" }, yearlyPrice: { amount: 799_900, currency: "ARS", interval: "year" },
    description: "Medios, consultoras y equipos de comunicación: roles, moderación y reglas comunes.",
    features: [...PRO, "org_rules", "team_rooms"], channels: ["web", "api", "whatsapp", "telegram", "email", "sms"],
    limits: { analysesPerDay: 3_000, comparisonsPerMonth: 10_000, maxSourcesPerComparison: 30, maxIncludeUrls: 20, maxSavedRuleSets: 200, maxAlerts: 200, maxSourceConnections: 30, seats: 10 },
  },
  {
    id: "empresa", name: "Empresa", tier: 4, audience: "organization", price: { amount: 399_990, currency: "ARS", interval: "month" }, yearlyPrice: { amount: 3_999_900, currency: "ARS", interval: "year" },
    description: "Volumen alto, asientos ilimitados y soporte dedicado.",
    features: [...PRO, "org_rules", "team_rooms", "bi_feed", "white_label"], channels: ["web", "api", "whatsapp", "telegram", "email", "sms"],
    limits: { analysesPerDay: null, comparisonsPerMonth: null, maxSourcesPerComparison: 50, maxIncludeUrls: 50, maxSavedRuleSets: null, maxAlerts: null, maxSourceConnections: null, seats: null },
  },
];

/**
 * Políticas por plataforma (cumplimiento y reputación). Valores conservadores:
 * conviene revisarlos contra las reglas vigentes de cada plataforma.
 */
export const PLATFORM_POLICIES: PlatformPolicy[] = [
  {
    destination: "whatsapp", maxPerMinute: 60, minSecondsPerRecipient: 6, requiresOptIn: true,
    conversationWindowHours: 24, templatesOutsideWindow: true, requiresBotDisclosure: true, requiresUnsubscribe: true,
    notes: "Fuera de las 24 h desde el último mensaje del usuario, sólo plantillas aprobadas por Meta. Espaciar los mensajes a una misma persona.",
  },
  { destination: "telegram", maxPerMinute: 600, minSecondsPerRecipient: 1, requiresOptIn: true, requiresBotDisclosure: false, requiresUnsubscribe: true, notes: "Los bots de Telegram ya se muestran como bots." },
  { destination: "email", maxPerHour: 500, maxPerDay: 2_000, minSecondsPerRecipient: 30, requiresOptIn: true, requiresBotDisclosure: true, requiresUnsubscribe: true, notes: "Dominio propio con SPF, DKIM y DMARC; subir volumen de a poco." },
  { destination: "sms", maxPerMinute: 10, minSecondsPerRecipient: 60, requiresOptIn: true, requiresBotDisclosure: true, requiresUnsubscribe: true },
  { destination: "discourse:*", maxPerHour: 5, maxPerDay: 20, minSecondsPerRecipient: 3_600, requiresOptIn: false, requiresBotDisclosure: true, requiresUnsubscribe: false, notes: "Una respuesta por hilo por hora; respetar las reglas de cada foro." },
  { destination: "wordpress:*", maxPerHour: 5, maxPerDay: 20, minSecondsPerRecipient: 86_400, requiresOptIn: false, requiresBotDisclosure: true, requiresUnsubscribe: false, notes: "Un comentario por nota por día." },
  { destination: "site:*", maxPerMinute: 60, requiresOptIn: false, requiresBotDisclosure: false, requiresUnsubscribe: false, notes: "Sitios que integraron Sin Humo a propósito." },
];

export const DEFAULT_POLICY: Omit<PlatformPolicy, "destination"> = {
  maxPerHour: 10, maxPerDay: 50, requiresOptIn: true, requiresBotDisclosure: true, requiresUnsubscribe: true,
};

/** Descripciones para mostrar en la página de precios. */
export const FEATURE_LABELS: Record<Feature, string> = {
  smoke_analysis: "Detector de humo",
  content_analysis: "Análisis de mails, mensajes y otros contenidos",
  source_comparison: "Comparación de fuentes",
  origin_trace: "¿Quién lo dijo primero?",
  credibility_meter: "Medidor de credibilidad",
  credibility_timeline: "Evolución de la credibilidad",
  url_rules: "Reglas de URLs (incluir/excluir)",
  alerts: "Alertas",
  ai_engine: "Motor con IA",
  export: "Exportar",
  api_access: "API, bots y MCP",
  org_rules: "Reglas de organización",
  source_connections: "Buzones y feeds conectados",
  public_replies: "Respuestas en foros y páginas",
  webhooks: "Webhooks",
  campaigns: "Campañas para contrarrestar el humo",
  team_rooms: "Salas del equipo en tiempo real",
  scheduled_reports: "Reportes automáticos por mail",
  bi_feed: "Conexión con Power BI, Looker Studio y otras herramientas de BI",
  white_label: "Marca blanca: tu logo, tus colores, tu dominio",
  learning_mode: "Modo aprendizaje para escuelas",
  audio_replies: "Respuestas en audio",
  voice_notes: "Entiende notas de voz",
  screenshots: "Lee capturas de pantalla",
  evidence_archive: "Archivo de evidencias: copias de notas con sello de tiempo y aviso de ediciones",
  daily_digest: "Resumen diario (el semanal viene en todos los planes)",
};

/**
 * PRECIOS DE PROVEEDORES para calcular costos. VALORES DE EJEMPLO: cargar los
 * vigentes de cada proveedor (IA por millón de tokens, WhatsApp por mensaje, etc.).
 */
export const PRICE_TABLE: import("../domain/model").PriceTable = {
  llm: {
    default: { inputPerMillionTokensUsd: 3, outputPerMillionTokensUsd: 15 },
    "claude-haiku-4-5": { inputPerMillionTokensUsd: 1, outputPerMillionTokensUsd: 5 },
  },
  perMessageUsd: { whatsapp: 0.01, telegram: 0, email: 0.0002, sms: 0.05 },
  speechToTextPerMinuteUsd: 0.006,
  textToSpeechPerMillionCharsUsd: 16,
  ocrPerImageUsd: 0.002,
  translationPerMillionCharsUsd: 20,
};

/** Política de costos (cotización y umbrales de alerta). La cotización hay que actualizarla. */
export const COST_POLICY = { usdToArs: 1_400, maxCostShare: 0.3, freeTierMaxUsd: 0.5 };

/** Tareas recurrentes (una por franja aunque haya varios servidores). */
export const SCHEDULES: import("../domain/model").RecurringSchedule[] = [
  { name: "sync_sources", jobType: "sync_sources", everyMinutes: 15 },
  { name: "evaluate_alerts", jobType: "evaluate_alerts", everyMinutes: 15 },
  { name: "ingest_feeds", jobType: "ingest_feeds", everyMinutes: 30 },
  { name: "send_reports", jobType: "send_reports", everyMinutes: 60 },
  { name: "support_sla", jobType: "support_sla", everyMinutes: 60 },
  { name: "media_cleanup", jobType: "media_cleanup", everyMinutes: 1_440 },
  { name: "evidence_recheck", jobType: "evidence_recheck", everyMinutes: 60 },
  { name: "send_digests", jobType: "send_digests", everyMinutes: 15 },
  { name: "backup_daily", jobType: "backup_daily", everyMinutes: 1_440 },
  { name: "backup_verify", jobType: "backup_verify", everyMinutes: 10_080 },
  { name: "collect_impact", jobType: "collect_impact", everyMinutes: 360 },
  { name: "retention", jobType: "retention", everyMinutes: 1_440 },
];

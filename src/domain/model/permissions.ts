/**
 * Catálogo de permisos. Un permiso dice QUÉ puede hacer alguien, sin importar su plan.
 * (El plan dice qué funcionalidades PAGÓ; el rol dice qué le CORRESPONDE hacer.)
 */
export const PERMISSIONS = [
  // Uso del producto
  "smoke:analyze",
  "sources:compare",
  "origin:trace",
  "credibility:view",
  "credibility:timeline",
  "content:analyze", // analizar mails, mensajes y otros contenidos
  "sources:connect", // conectar buzones y feeds propios
  // Reglas y alertas
  "rules:own", // reglas personales (p. ej. excluir sitios)
  "rules:org", // reglas de la organización, obligatorias para sus miembros
  "alerts:own",
  // Operación editorial
  "verdicts:write", // cargar verificaciones (equipo de chequeo)
  "rebuttal:write", // derecho a réplica (representante de un medio)
  "rebuttal:resolve", // resolver réplicas
  "corrections:publish", // publicar fe de erratas
  // Participación
  "perspectives:write", // publicar "otra mirada"
  "campaigns:manage", // crear campañas
  "campaigns:review", // aprobar campañas (otra persona)
  "rooms:use", // salas de la organización
  // Respuestas publicadas en mails, foros, chats y páginas
  "replies:private", // responder en privado a quien consultó (hilo de mail, chat)
  "replies:publish_public", // publicar en foros/páginas (queda en revisión si no modera)
  "replies:moderate", // aprobar o rechazar respuestas públicas
  // Integraciones
  "api_keys:manage", // crear claves para bots, agentes y MCP
  "webhooks:manage",
  "outlets:write", // dueños, pauta, datos de medios
  "quality:manage", // ejemplos etiquetados, evaluar y activar versiones del algoritmo
  // Administración
  "users:read_org",
  "users:manage_org",
  "users:manage_all",
  "subscriptions:manage_org",
  "plans:manage",
  "audit:read",
  // Estadísticas
  "stats:org", // panel de la organización y su conexión con BI
  "stats:business", // métricas del negocio (MRR, bajas, conversión)
  // Configuración del negocio
  "taxonomy:manage", // temas y categorías
  "rules:business", // reglas declarativas y parámetros de la plataforma
  "flags:manage", // funciones en prueba (feature flags)
  "support:handle", // atender tickets de soporte
  "learning:teach", // crear aulas y ver el progreso de sus estudiantes
  "ops:backup", // copias de seguridad (listar, crear, verificar)
  "evidence:capture", // guardar copias de notas con huella y sello de tiempo
  "evidence:read_all", // ver todas las copias archivadas (verificadores)
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Secciones del backoffice y el permiso que muestra cada una (el servidor controla cada acción igual). */
export const ADMIN_SECTIONS = [
  { path: "personas", label: "Personas", permission: "users:manage_all" },
  { path: "soporte", label: "Soporte", permission: "support:handle" },
  { path: "verificacion", label: "Verificación", permission: "verdicts:write" },
  { path: "replicas", label: "Réplicas de medios", permission: "rebuttal:resolve" },
  { path: "erratas", label: "Fe de erratas", permission: "corrections:publish" },
  { path: "eventos", label: "Eventos en vivo", permission: "events:host" },
  { path: "abuso", label: "Abuso y restricciones", permission: "abuse:manage" },
  { path: "metricas", label: "Métricas del negocio", permission: "stats:business" },
  { path: "parametros", label: "Parámetros", permission: "rules:business" },
  { path: "reglas", label: "Reglas del negocio", permission: "rules:business" },
  { path: "planes", label: "Planes", permission: "plans:manage" },
  { path: "legal", label: "Documentos legales", permission: "legal:publish" },
  { path: "cupones", label: "Cupones", permission: "plans:manage" },
  { path: "funciones", label: "Funciones en prueba", permission: "flags:manage" },
  { path: "temas", label: "Temas", permission: "taxonomy:manage" },
  { path: "calidad", label: "Calidad del algoritmo", permission: "quality:manage" },
  { path: "documentos", label: "Documentos oficiales", permission: "verdicts:write" },
  { path: "medios", label: "Medios", permission: "outlets:write" },
  { path: "catalogo", label: "Importar catálogo", permission: "outlets:write" },
  { path: "auditoria", label: "Auditoría", permission: "audit:read" },
  { path: "costos", label: "Costos", permission: "plans:manage" },
  { path: "copias", label: "Copias de seguridad", permission: "ops:backup" },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

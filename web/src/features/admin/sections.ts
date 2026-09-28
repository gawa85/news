/** Secciones del backoffice y el permiso que muestra cada una (el servidor controla cada acción igual). */
export const ADMIN_SECTIONS = [
  { path: "soporte", label: "Soporte", permission: "support:handle" },
  { path: "verificacion", label: "Verificación", permission: "verdicts:write" },
  { path: "replicas", label: "Réplicas de medios", permission: "rebuttal:resolve" },
  { path: "eventos", label: "Eventos en vivo", permission: "events:host" },
  { path: "abuso", label: "Abuso y restricciones", permission: "abuse:manage" },
  { path: "metricas", label: "Métricas del negocio", permission: "stats:business" },
  { path: "parametros", label: "Parámetros", permission: "rules:business" },
  { path: "reglas", label: "Reglas del negocio", permission: "rules:business" },
  { path: "funciones", label: "Funciones en prueba", permission: "flags:manage" },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

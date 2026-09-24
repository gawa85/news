/**
 * AMBIENTES. Mismo código, distinta configuración y distintas protecciones.
 *   development: tu máquina. Base en memoria o SQLite, datos de demo, nada sale a gente real.
 *   test:        pruebas automáticas. Todo falso y aislado.
 *   staging:     copia de producción para probar antes de publicar. Datos ANONIMIZADOS,
 *                mensajes sólo a una lista de números/mails del equipo, pagos en modo prueba.
 *   production:  gente real. Chequeos estrictos al arrancar.
 */
export type EnvironmentName = "development" | "test" | "staging" | "production";

export interface EnvironmentProfile {
  name: EnvironmentName;
  label: string;
  /** ¿Se puede escribir a cualquier persona? (sólo producción) */
  realRecipients: boolean;
  /** Prefijo visible en todo lo que se envía fuera de producción. */
  messagePrefix?: string;
  requireHttps: boolean;
  requirePostgres: boolean;
  allowDemoData: boolean;
  requireBackups: boolean;
  /** Variables que tienen que estar sí o sí. */
  requiredVars: string[];
}

export const ENVIRONMENTS: Record<EnvironmentName, EnvironmentProfile> = {
  development: {
    name: "development", label: "Desarrollo", realRecipients: false, messagePrefix: "[DESARROLLO]", requireHttps: false, requirePostgres: false,
    allowDemoData: true, requireBackups: false, requiredVars: [],
  },
  test: {
    name: "test", label: "Pruebas", realRecipients: false, messagePrefix: "[PRUEBA]", requireHttps: false, requirePostgres: false,
    allowDemoData: true, requireBackups: false, requiredVars: [],
  },
  staging: {
    name: "staging", label: "Preproducción", realRecipients: false, messagePrefix: "[PRUEBA]", requireHttps: true, requirePostgres: true,
    allowDemoData: true, requireBackups: false, requiredVars: ["DATABASE_URL", "VAULT_MASTER_KEY", "PUBLIC_BASE_URL", "SANDBOX_RECIPIENTS"],
  },
  production: {
    name: "production", label: "Producción", realRecipients: true, requireHttps: true, requirePostgres: true,
    allowDemoData: false, requireBackups: true,
    requiredVars: ["DATABASE_URL", "VAULT_MASTER_KEY", "PUBLIC_BASE_URL", "METRICS_TOKEN", "BACKUP_PASSPHRASE", "STATS_PSEUDONYM_SECRET"],
  },
};

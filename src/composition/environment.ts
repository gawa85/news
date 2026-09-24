import { ENVIRONMENTS, type EnvironmentName, type EnvironmentProfile } from "../config/environments";

export function profileFor(name: string | undefined): EnvironmentProfile {
  const n = (name ?? "development").toLowerCase() as EnvironmentName;
  const p = ENVIRONMENTS[n];
  if (!p) throw new Error(`Ambiente desconocido: ${name}. Usá development, test, staging o production.`);
  return p;
}

const WEAK = /^(changeme|cambiar|secret|secreto|password|test|demo|123)/i;

/**
 * Chequeos al ARRANCAR: si falta algo crítico, el servidor no arranca (mejor que arrancar mal).
 * Devuelve la lista de problemas (vacía = todo bien).
 */
export function validateEnvironment(p: EnvironmentProfile, env: Record<string, string | undefined>): string[] {
  const errors: string[] = [];
  for (const v of p.requiredVars) if (!env[v]?.trim()) errors.push(`Falta la variable ${v}.`);
  const secret = (name: string, min: number) => {
    const v = env[name];
    if (v && (v.length < min || WEAK.test(v))) errors.push(`${name} es débil: usá al menos ${min} caracteres aleatorios.`);
  };
  if (p.name === "production" || p.name === "staging") {
    secret("VAULT_MASTER_KEY", 32);
    secret("BACKUP_PASSPHRASE", 24);
    secret("STATS_PSEUDONYM_SECRET", 24);
    secret("METRICS_TOKEN", 24);
  }
  if (p.requireHttps && env.PUBLIC_BASE_URL && !env.PUBLIC_BASE_URL.startsWith("https://")) errors.push("PUBLIC_BASE_URL tiene que ser https en este ambiente.");
  if (p.requirePostgres && env.DATABASE_URL && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) errors.push("En este ambiente la base tiene que ser PostgreSQL.");
  if (!p.allowDemoData && env.LOAD_DEMO_DATA === "1") errors.push("No se cargan datos de demo en producción.");
  if (p.requireBackups && !env.BACKUP_DIR && !env.BACKUP_S3_BUCKET) errors.push("Configurá dónde se guardan las copias (BACKUP_DIR o BACKUP_S3_BUCKET).");
  if (p.name === "production" && env.PAYMENTS_SANDBOX === "1") errors.push("Producción no puede usar pagos en modo prueba.");
  if (p.name !== "production" && env.DATABASE_URL && env.PRODUCTION_DATABASE_HOST && env.DATABASE_URL.includes(env.PRODUCTION_DATABASE_HOST)) {
    errors.push("Este ambiente apunta a la base de PRODUCCIÓN. Usá una copia anonimizada.");
  }
  return errors;
}

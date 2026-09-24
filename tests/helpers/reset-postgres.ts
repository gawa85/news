/**
 * Deja vacía la base de pruebas de PostgreSQL antes de correr la batería: cada test crea
 * su propio esquema y, si no se borran, se acumulan miles de tablas entre corridas.
 * Uso: TEST_DATABASE_URL=postgres://…/sinhumo_test node dist/tests/helpers/reset-postgres.js
 */
import { PostgresClient } from "../../src/infrastructure/persistence/sql/PostgresClient";

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "");
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) throw new Error(`Por seguridad, sólo se vacían bases con "test" en el nombre (recibí "${name}").`);
  url.pathname = "/postgres";
  const admin = new PostgresClient(url.toString(), 1);
  try {
    await admin.run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.run(`CREATE DATABASE ${name}`);
  } finally {
    await admin.close();
  }
  console.log(`Base de pruebas ${name} vacía.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

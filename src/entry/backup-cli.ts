/**
 * Copias de seguridad por línea de comandos:
 *   node dist/src/entry/backup-cli.js crear [manual|pre_migration]
 *   node dist/src/entry/backup-cli.js listar
 *   node dist/src/entry/backup-cli.js verificar <clave>
 *   node dist/src/entry/backup-cli.js restaurar <clave> --destino <DATABASE_URL de una base VACÍA> --confirmo
 *   node dist/src/entry/backup-cli.js copia-staging         (anonimizada, para el ambiente de prueba)
 * Usa las mismas variables que el servidor (BACKUP_PASSPHRASE, BACKUP_DIR o BACKUP_S3_*).
 */
import { BackupService } from "../application/ops/Backups";
import { createMemoryStore, createPostgresStore, createSqliteStore } from "../infrastructure/persistence/stores";
import { ConsoleLogger, SystemClock } from "../infrastructure/system/System";
import { backupSinkFromEnv, storeFromEnv } from "./env";

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const sink = backupSinkFromEnv();
  const pass = process.env.BACKUP_PASSPHRASE;
  if (!sink || !pass) throw new Error("Configurá BACKUP_PASSPHRASE y BACKUP_DIR o BACKUP_S3_BUCKET.");
  const store = storeFromEnv();
  await store.migrate();
  const svc = new BackupService(store, sink, pass, () => createMemoryStore(), new SystemClock(), new ConsoleLogger(true), process.env.APP_ENV ?? "development");
  switch (cmd) {
    case "crear":
      console.log(await svc.create((arg as "manual" | "pre_migration") ?? "manual"));
      break;
    case "listar":
      for (const m of await svc.list()) console.log(`${m.createdAt}  ${m.kind.padEnd(13)} ${(m.bytes / 1024).toFixed(0).padStart(8)} KB  ${m.verification?.ok ? "verificada" : m.verification ? "¡FALLÓ!" : "sin verificar"}  ${m.key}`);
      break;
    case "verificar":
      console.log(await svc.verify(arg!));
      break;
    case "copia-staging":
      console.log(await svc.create("staging_copy", { scrubSecret: process.env.STAGING_SCRUB_SECRET }));
      break;
    case "restaurar": {
      const i = process.argv.indexOf("--destino");
      const dest = i > 0 ? process.argv[i + 1] : undefined;
      if (!dest || !process.argv.includes("--confirmo")) throw new Error("Indicá --destino <url de una base vacía> y --confirmo.");
      const target = dest.startsWith("postgres") ? createPostgresStore(dest) : createSqliteStore(dest);
      await target.migrate();
      console.log(await svc.restore(arg!, target));
      await target.close();
      break;
    }
    default:
      console.log("Comandos: crear | listar | verificar <clave> | restaurar <clave> --destino <url> --confirmo | copia-staging");
  }
  await store.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { AccessDeniedError, NotFoundError, ValidationError } from "../../domain/errors";
import type { BackupManifest, IAuthorizationService, IBackupSink, IClock, IDataStore, IDomainEvents, ILogger, IUserRepository } from "../../domain/ports";
import { Scrubber } from "./Scrubber";

const MAGIC = Buffer.from("SHBK1");

export interface RetentionPolicy {
  daily: number;
  weekly: number;
  monthly: number;
  /** Las manuales y previas a migraciones se guardan este tiempo. */
  manualDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { daily: 7, weekly: 4, monthly: 12, manualDays: 365 };

/**
 * Qué copias conservar (abuelo-padre-hijo): las últimas N diarias, la última de cada una de
 * las últimas N semanas y la última de cada uno de los últimos N meses. Función pura.
 */
export function retentionPlan(items: Pick<BackupManifest, "key" | "kind" | "createdAt">[], now: Date, p: RetentionPolicy): { keep: string[]; remove: string[] } {
  const keep = new Set<string>();
  const auto = items.filter((i) => i.kind === "daily").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  auto.slice(0, p.daily).forEach((i) => keep.add(i.key));
  const pick = (bucket: (d: Date) => string, n: number) => {
    const seen = new Set<string>();
    for (const i of auto) {
      const b = bucket(new Date(i.createdAt));
      if (seen.has(b)) continue;
      seen.add(b);
      if (seen.size > n) break;
      keep.add(i.key);
    }
  };
  pick((d) => {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return String(Math.floor((t / 86_400_000 + 3) / 7)); // semanas que empiezan el lunes
  }, p.weekly);
  pick((d) => d.toISOString().slice(0, 7), p.monthly);
  for (const i of items) if (i.kind !== "daily" && now.getTime() - new Date(i.createdAt).getTime() <= p.manualDays * 86_400_000) keep.add(i.key);
  return { keep: [...keep], remove: items.map((i) => i.key).filter((k) => !keep.has(k)) };
}

/**
 * COPIAS DE SEGURIDAD lógicas, iguales para memoria, SQLite y PostgreSQL.
 *  - Todas las colecciones (menos las efímeras), comprimidas y CIFRADAS (AES-256-GCM con clave
 *    derivada de una frase secreta que NO está en la base). Sin la frase no se pueden leer.
 *  - Suma de verificación (SHA-256) en un manifiesto aparte (sin datos personales).
 *  - Verificación periódica: se restaura en una base vacía y se comparan las cantidades.
 *    Una copia que no se probó restaurar no cuenta como copia.
 *  - Retención abuelo-padre-hijo.
 *  - Copia ANONIMIZADA para ambientes de prueba (sin secretos ni datos personales).
 * Para producción con PostgreSQL, además: copias físicas con WAL (recuperación a un minuto dado).
 */
export class BackupService {
  constructor(
    private readonly store: IDataStore,
    private readonly sink: IBackupSink,
    private readonly passphrase: string,
    private readonly scratch: () => IDataStore,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    private readonly environment: string,
    private readonly events?: IDomainEvents,
    private readonly authz?: { users: IUserRepository; authz: IAuthorizationService },
    private readonly retention: RetentionPolicy = DEFAULT_RETENTION,
  ) {
    if (passphrase.length < 16) throw new Error("La frase de cifrado de las copias tiene que tener al menos 16 caracteres.");
  }

  async create(kind: BackupManifest["kind"] = "daily", opts: { scrubSecret?: string } = {}): Promise<BackupManifest> {
    const now = this.clock.now();
    const scrubber = kind === "staging_copy" ? new Scrubber(opts.scrubSecret ?? randomBytes(32).toString("hex")) : undefined;
    const counts: Record<string, number> = {};
    const lines: string[] = [];
    for (const name of this.store.raw.collections()) {
      const docs = await this.store.raw.read(name);
      let n = 0;
      for (const d of docs) {
        const out = scrubber ? scrubber.scrub(name, d) : d;
        if (out === undefined) continue;
        lines.push(JSON.stringify({ c: name, d: out }));
        n++;
      }
      counts[name] = n;
    }
    const id = `${now.toISOString().replace(/[:.]/g, "-")}-${kind}`;
    const key = `${kind === "staging_copy" ? "staging" : "backups"}/${now.toISOString().slice(0, 10).replace(/-/g, "/")}/sinhumo-${id}.shbk`;
    const header = { formatVersion: 1, id, kind, createdAt: now.toISOString(), engine: this.store.engine, environment: this.environment, scrubbed: !!scrubber, collections: counts };
    const plain = gzipSync(Buffer.from([JSON.stringify(header), ...lines].join("\n"), "utf8"));
    const data = this.encrypt(plain);
    const manifest: BackupManifest = { ...header, formatVersion: 1, key, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") };
    await this.sink.put(key, data);
    await this.sink.put(`${key}.json`, Buffer.from(JSON.stringify(manifest, null, 2)));
    this.logger.info("Copia de seguridad creada", { key, bytes: data.length, collections: Object.keys(counts).length });
    return manifest;
  }

  async list(): Promise<BackupManifest[]> {
    const keys = (await this.sink.list("backups/")).filter((k) => k.endsWith(".shbk.json"));
    const out: BackupManifest[] = [];
    for (const k of keys) {
      const b = await this.sink.get(k);
      if (b) out.push(JSON.parse(b.toString("utf8")) as BackupManifest);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Restaura una copia en `target`. Por seguridad, sólo en una base VACÍA
   * (salvo `allowNonEmpty`, por ejemplo para restaurar una sola colección a mano).
   * Todo se valida (suma, cifrado, formato) ANTES de escribir nada.
   */
  async restore(key: string, target: IDataStore, opts: { allowNonEmpty?: boolean; only?: string[] } = {}): Promise<Record<string, number>> {
    const { header, entries } = await this.open(key);
    if (!opts.allowNonEmpty) {
      for (const name of target.raw.collections()) {
        if (["roles", "plans"].includes(name)) continue; // los carga la semilla
        if ((await target.raw.count(name)) > 0) throw new ValidationError(`La base de destino no está vacía (${name}). Restaurá en una base nueva.`);
      }
    }
    const known = new Set(target.raw.collections());
    const byCollection = new Map<string, string[]>();
    for (const e of entries) {
      if (opts.only && !opts.only.includes(e.c)) continue;
      if (!known.has(e.c)) {
        this.logger.warn("Colección que ya no existe: se omite", { collection: e.c });
        continue;
      }
      byCollection.set(e.c, [...(byCollection.get(e.c) ?? []), e.d]);
    }
    const restored: Record<string, number> = {};
    for (const [name, docs] of byCollection) {
      await target.raw.write(name, docs);
      restored[name] = docs.length;
    }
    this.logger.info("Copia restaurada", { key, from: header.createdAt, collections: Object.keys(restored).length });
    return restored;
  }

  /** Prueba de restauración en una base vacía: las cantidades tienen que coincidir. */
  async verify(key: string): Promise<BackupManifest> {
    const manifestBuf = await this.sink.get(`${key}.json`);
    if (!manifestBuf) throw new NotFoundError("No existe esa copia.");
    const manifest = JSON.parse(manifestBuf.toString("utf8")) as BackupManifest;
    let verification: { ok: boolean; detail: string };
    try {
      const scratch = this.scratch();
      await scratch.migrate();
      await this.restore(key, scratch);
      const diffs: string[] = [];
      for (const [name, n] of Object.entries(manifest.collections)) {
        const got = await scratch.raw.count(name);
        if (got !== n) diffs.push(`${name}: ${got} de ${n}`);
      }
      await scratch.close();
      verification = diffs.length ? { ok: false, detail: `No coinciden: ${diffs.join(", ")}` } : { ok: true, detail: `${Object.values(manifest.collections).reduce((a, b) => a + b, 0)} documentos restaurados sin diferencias.` };
    } catch (err) {
      verification = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    const updated = { ...manifest, verifiedAt: this.clock.now().toISOString(), verification };
    await this.sink.put(`${key}.json`, Buffer.from(JSON.stringify(updated, null, 2)));
    if (!verification.ok) this.logger.error("¡La copia de seguridad NO se pudo restaurar!", { key, detail: verification.detail });
    return updated;
  }

  /** Trabajo diario: copia + borrar las que ya no hacen falta según la retención. */
  async runDaily(): Promise<{ created: string; removed: number }> {
    const m = await this.create("daily");
    const plan = retentionPlan(await this.list(), this.clock.now(), this.retention);
    for (const k of plan.remove) {
      await this.sink.delete(k);
      await this.sink.delete(`${k}.json`);
    }
    return { created: m.key, removed: plan.remove.length };
  }

  /** Trabajo semanal: verifica la copia más reciente. */
  async verifyLatest(): Promise<BackupManifest | undefined> {
    const [latest] = await this.list();
    return latest ? this.verify(latest.key) : undefined;
  }

  /** Para la API de administración (permiso `ops:backup`). */
  async requireOperator(actorId: string): Promise<void> {
    const u = await this.authz?.users.findById(actorId);
    if (!u || !(await this.authz!.authz.permissionsOf(u)).has("ops:backup")) throw new AccessDeniedError("No tenés permiso para gestionar copias de seguridad.", "no_permission");
    await this.events?.emit("ops.backup_accessed", { userId: u.id }, {});
  }

  private encrypt(plain: Buffer): Buffer {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.passphrase, salt, 32);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const body = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]);
  }

  private decrypt(data: Buffer): Buffer {
    if (!data.subarray(0, 5).equals(MAGIC)) throw new ValidationError("No es una copia de Sin Humo.");
    const salt = data.subarray(5, 21);
    const iv = data.subarray(21, 33);
    const tag = data.subarray(33, 49);
    const d = createDecipheriv("aes-256-gcm", scryptSync(this.passphrase, salt, 32), iv);
    d.setAuthTag(tag);
    try {
      return Buffer.concat([d.update(data.subarray(49)), d.final()]);
    } catch {
      throw new ValidationError("No se pudo descifrar: frase incorrecta o archivo alterado.");
    }
  }

  private async open(key: string) {
    const data = await this.sink.get(key);
    if (!data) throw new NotFoundError(`No existe la copia ${key}.`);
    const manifestBuf = await this.sink.get(`${key}.json`);
    if (manifestBuf) {
      const m = JSON.parse(manifestBuf.toString("utf8")) as BackupManifest;
      if (createHash("sha256").update(data).digest("hex") !== m.sha256) throw new ValidationError("La copia está dañada (la suma de verificación no coincide).");
    }
    const [head, ...rest] = gunzipSync(this.decrypt(data)).toString("utf8").split("\n");
    const header = JSON.parse(head!) as { formatVersion: number; createdAt: string };
    if (header.formatVersion !== 1) throw new ValidationError(`Formato de copia no soportado: ${header.formatVersion}.`);
    return { header, entries: rest.filter(Boolean).map((l) => JSON.parse(l) as { c: string; d: string }) };
  }
}

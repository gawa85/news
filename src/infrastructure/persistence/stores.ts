/**
 * Fábricas de IDataStore. La raíz de composición elige una; el resto del sistema no se entera.
 *
 *   createMemoryStore()                 → tests, demo
 *   createSqliteStore("datos.db")       → desarrollo local, instalación chica
 *   createPostgresStore(process.env.DATABASE_URL)  → producción
 */
import type { IDataStore, IRawStore, Repositories } from "../../domain/ports";
import { codec, type CollectionSchema, type ICollectionFactory } from "./collection";
import { MemoryCollectionFactory } from "./memory/MemoryCollections";
import { buildRepositories } from "./repositories";
import { schemas } from "./schemas";
import { PostgresClient, postgresDialect } from "./sql/PostgresClient";
import { SqliteClient, sqliteDialect } from "./sql/SqliteClient";
import { SqlCollectionFactory, type ISqlClient, type SqlDialect } from "./sql/SqlCollections";

/** Tablas efímeras o secretas de corta vida: no se respaldan (al restaurar, hay que volver a iniciar sesión). */
export const NOT_BACKED_UP = new Set(["verification_codes", "sessions", "magic_links", "oauth_states", "login_attempts", "media_files"]);

function rawOver(factory: () => ICollectionFactory): IRawStore {
  const byName = new Map(Object.values(schemas).map((s) => [(s as CollectionSchema<unknown>).name, s as CollectionSchema<unknown>]));
  const col = (name: string) => {
    const schema = byName.get(name);
    if (!schema) throw new Error(`Colección desconocida: ${name}`);
    return factory().collection(schema);
  };
  return {
    collections: () => [...byName.keys()].filter((n) => !NOT_BACKED_UP.has(n)).sort(),
    read: async (name) => (await col(name).find()).map((d) => codec.encode(d)),
    write: async (name, docs) => {
      const c = col(name);
      for (const d of docs) await c.upsert(codec.decode(d));
    },
    count: (name) => col(name).count(),
  };
}

class MemoryDataStore implements IDataStore {
  readonly engine = "memory";
  readonly repos: Repositories;
  private readonly factory = new MemoryCollectionFactory();
  private queue: Promise<unknown> = Promise.resolve();

  readonly raw: IRawStore = rawOver(() => this.factory);

  constructor() {
    this.repos = buildRepositories(this.factory);
  }

  async migrate() {
    for (const s of Object.values(schemas)) (this.factory as ICollectionFactory).collection(s as never);
  }

  /** Transacción simulada: si algo falla, se restaura la foto previa. */
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const snapshot = this.factory.snapshot();
      try {
        return await work(this.repos);
      } catch (err) {
        this.factory.restore(snapshot);
        throw err;
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async close() {}
}

class SqlDataStore implements IDataStore {
  readonly repos: Repositories;
  readonly raw: IRawStore = rawOver(() => new SqlCollectionFactory(this.client, this.dialect));

  constructor(
    private readonly client: ISqlClient,
    private readonly dialect: SqlDialect,
  ) {
    this.repos = buildRepositories(new SqlCollectionFactory(client, dialect));
  }

  get engine() {
    return this.dialect.name;
  }

  async migrate() {
    const factory = new SqlCollectionFactory(this.client, this.dialect);
    for (const s of Object.values(schemas)) await factory.collection(s as never).migrate();
  }

  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.client.transaction((tx) => work(buildRepositories(new SqlCollectionFactory(tx, this.dialect))));
  }

  close() {
    return this.client.close();
  }
}

export function createMemoryStore(): IDataStore {
  return new MemoryDataStore();
}

export function createSqliteStore(path = ":memory:"): IDataStore {
  return new SqlDataStore(new SqliteClient(path), sqliteDialect);
}

export function createPostgresStore(connectionString: string, maxConnections?: number): IDataStore {
  return new SqlDataStore(new PostgresClient(connectionString, maxConnections), postgresDialect);
}

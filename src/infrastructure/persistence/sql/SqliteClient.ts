import type { DatabaseSync } from "node:sqlite";
import type { ISqlClient, Row, SqlDialect, SqlParam } from "./SqlCollections";

export const sqliteDialect: SqlDialect = {
  name: "sqlite",
  jsonType: "TEXT",
  numberType: "REAL",
  selectJson: (c) => c,
  listColumnsSql: "SELECT name FROM pragma_table_info(?)",
  isUniqueViolation: (e) => e instanceof Error && /UNIQUE constraint failed|PRIMARY KEY/i.test(e.message),
};

/**
 * SQLite con el módulo integrado de Node (sin dependencias).
 * Ideal para desarrollo, tests, una instalación chica o un modo "offline".
 */
export class SqliteClient implements ISqlClient {
  private readonly db: DatabaseSync;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(path = ":memory:") {
    // Carga diferida: sólo se importa si se elige este motor.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync: Db } = require("node:sqlite") as typeof import("node:sqlite");
    this.db = new Db(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }

  async all(sql: string, params: SqlParam[] = []): Promise<Row[]> {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  async run(sql: string, params: SqlParam[] = []): Promise<number> {
    return Number(this.db.prepare(sql).run(...params).changes);
  }

  /** Una conexión = una transacción por vez: se encolan. */
  transaction<T>(work: (tx: ISqlClient) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      this.db.exec("BEGIN");
      try {
        const result = await work(this);
        this.db.exec("COMMIT");
        return result;
      } catch (err) {
        this.db.exec("ROLLBACK");
        throw err;
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
